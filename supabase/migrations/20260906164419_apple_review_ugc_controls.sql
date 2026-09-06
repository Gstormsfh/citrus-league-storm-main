-- Account-owned safety controls; separate from scoring and draft model data.
CREATE TABLE public.user_blocks (
  blocker_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  blocked_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (blocker_id, blocked_id),
  CHECK (blocker_id <> blocked_id)
);
CREATE INDEX user_blocks_blocked_idx ON public.user_blocks(blocked_id);
ALTER TABLE public.user_blocks ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.user_blocks FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, DELETE ON public.user_blocks TO authenticated;
CREATE POLICY own_blocks ON public.user_blocks FOR ALL TO authenticated
  USING (blocker_id = (SELECT auth.uid()))
  WITH CHECK (blocker_id = (SELECT auth.uid()));

CREATE TABLE public.content_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reporter_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  reported_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  notification_id uuid REFERENCES public.notifications(id) ON DELETE SET NULL,
  reason text NOT NULL CHECK (char_length(reason) BETWEEN 1 AND 1000),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','resolved','dismissed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  UNIQUE (reporter_id, notification_id)
);
CREATE INDEX content_reports_subject_idx ON public.content_reports(reported_user_id);
CREATE INDEX content_reports_notification_idx ON public.content_reports(notification_id);
ALTER TABLE public.content_reports ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.content_reports FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON public.content_reports TO authenticated;
CREATE POLICY own_reports_read ON public.content_reports FOR SELECT TO authenticated
  USING (reporter_id = (SELECT auth.uid()));
CREATE POLICY own_reports_insert ON public.content_reports FOR INSERT TO authenticated
  WITH CHECK (reporter_id = (SELECT auth.uid()) AND status = 'open' AND resolved_at IS NULL
    AND EXISTS (SELECT 1 FROM public.notifications n WHERE n.id = notification_id
      AND n.user_id = (SELECT auth.uid()) AND n.type = 'CHAT'
      AND n.metadata->>'sender_id' = reported_user_id::text));
CREATE INDEX content_reports_open_idx ON public.content_reports(created_at) WHERE status = 'open';
GRANT ALL ON public.user_blocks, public.content_reports TO service_role;

-- Existing permissive notification policies remain in force; this extra
-- restriction also covers direct REST and Realtime reads of old chat rows.
CREATE POLICY hide_blocked_chat ON public.notifications AS RESTRICTIVE FOR SELECT TO authenticated
  USING (type <> 'CHAT' OR NOT EXISTS (
    SELECT 1 FROM public.user_blocks b WHERE b.blocker_id = (SELECT auth.uid())
      AND b.blocked_id::text = notifications.metadata->>'sender_id'
  ));

CREATE TABLE public.chat_suspensions (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  suspended_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX chat_suspensions_operator_idx ON public.chat_suspensions(suspended_by);
ALTER TABLE public.chat_suspensions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.chat_suspensions FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.chat_suspensions TO service_role;

CREATE OR REPLACE FUNCTION public.send_league_chat_message(p_league_id uuid, p_message text, p_sender_name text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_sender uuid := auth.uid();
  v_name text;
  v_count integer;
BEGIN
  IF v_sender IS NULL THEN
    RETURN jsonb_build_object('success',false,'error','Authentication required');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.leagues l WHERE l.id=p_league_id
    AND (l.commissioner_id=v_sender OR EXISTS (SELECT 1 FROM public.teams t WHERE t.league_id=l.id AND t.owner_id=v_sender))) THEN
    RETURN jsonb_build_object('success',false,'error','Not a member of this league');
  END IF;
  IF EXISTS (SELECT 1 FROM public.chat_suspensions WHERE user_id=v_sender) THEN
    RETURN jsonb_build_object('success',false,'error','Your chat access is suspended. Contact Citrus support.');
  END IF;
  IF p_message IS NULL OR char_length(trim(p_message)) NOT BETWEEN 1 AND 2000 THEN
    RETURN jsonb_build_object('success',false,'error','Messages must contain between 1 and 2000 characters');
  END IF;
  -- A baseline text filter supplements user reports and operator review.
  -- It is not a claim that a word list can detect every form of abuse.
  IF lower(normalize(p_message, NFKC)) ~ '\m(fuck\w*|shit\w*|cunt\w*|porn\w*|kill yourself)\M' THEN
    RETURN jsonb_build_object('success',false,'error','Please keep league chat respectful. Edit this message before sending.');
  END IF;
  -- Never accept a client-supplied display name as another user's identity.
  SELECT coalesce(nullif(username,''),nullif(default_team_name,''),'League member') INTO v_name
    FROM public.profiles WHERE id=v_sender;
  INSERT INTO public.notifications(league_id,user_id,type,title,message,metadata,read_status,read_at)
    SELECT p_league_id,m.id,'CHAT',coalesce(v_name,'League member')||' sent a message',trim(p_message),
      jsonb_build_object('sender_id',v_sender,'sender_name',coalesce(v_name,'League member')),
      m.id=v_sender,CASE WHEN m.id=v_sender THEN now() ELSE NULL END
    FROM (SELECT owner_id AS id FROM public.teams WHERE league_id=p_league_id AND owner_id IS NOT NULL
      UNION SELECT commissioner_id FROM public.leagues WHERE id=p_league_id) m
    WHERE NOT EXISTS (SELECT 1 FROM public.user_blocks b
      WHERE (b.blocker_id=m.id AND b.blocked_id=v_sender) OR (b.blocker_id=v_sender AND b.blocked_id=m.id));
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN jsonb_build_object('success',true,'notifications_created',v_count);
END;
$$;
REVOKE ALL ON FUNCTION public.send_league_chat_message(uuid,text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.send_league_chat_message(uuid,text,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.moderate_content_report(p_report_id uuid, p_action text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_report record;
  v_message record;
BEGIN
  IF auth.uid() IS NULL OR NOT EXISTS (SELECT 1 FROM public.profiles WHERE id=auth.uid() AND is_admin=true) THEN
    RAISE EXCEPTION 'Admin access required' USING ERRCODE='42501';
  END IF;
  IF p_action IS NULL OR p_action NOT IN ('dismiss','remove','suspend') THEN RAISE EXCEPTION 'Invalid moderation action'; END IF;
  SELECT id, notification_id, reported_user_id INTO v_report FROM public.content_reports WHERE id=p_report_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Report unavailable'; END IF;
  IF p_action IN ('remove','suspend') THEN
    SELECT league_id, message, created_at INTO v_message FROM public.notifications WHERE id=v_report.notification_id;
    IF FOUND THEN
      DELETE FROM public.notifications n WHERE n.type='CHAT' AND n.league_id=v_message.league_id
        AND n.metadata->>'sender_id'=v_report.reported_user_id::text
        AND n.message=v_message.message AND n.created_at=v_message.created_at;
    END IF;
  END IF;
  IF p_action='suspend' THEN
    INSERT INTO public.chat_suspensions(user_id,suspended_by) VALUES(v_report.reported_user_id,auth.uid())
      ON CONFLICT(user_id) DO NOTHING;
  END IF;
  UPDATE public.content_reports SET status=CASE WHEN p_action='dismiss' THEN 'dismissed' ELSE 'resolved' END,
    resolved_at=now() WHERE id=p_report_id;
  PERFORM public.log_security_event('ADMIN_ACTION',NULL,jsonb_build_object('action','content_moderation','report_id',p_report_id,'resolution',p_action),'WARN');
  RETURN jsonb_build_object('success',true);
END;
$$;
REVOKE ALL ON FUNCTION public.moderate_content_report(uuid,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.moderate_content_report(uuid,text) TO authenticated;

-- A client must not bypass the chat filter or impersonate a sender through
-- direct REST writes. Trusted server functions perform chat insertion.
CREATE POLICY chat_requires_send_function ON public.notifications AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK (type <> 'CHAT');
REVOKE UPDATE ON public.notifications FROM PUBLIC, anon, authenticated;
GRANT UPDATE (read_status, read_at) ON public.notifications TO authenticated;
