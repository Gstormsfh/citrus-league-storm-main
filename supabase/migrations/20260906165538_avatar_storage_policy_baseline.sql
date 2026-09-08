-- Bring staging into parity with the existing production avatar ownership rules.
-- Bucket creation uses the Storage API; do not insert storage metadata directly.
DO $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='storage' AND tablename='objects' AND policyname='Anyone can read avatars') THEN
  CREATE POLICY "Anyone can read avatars" ON storage.objects FOR SELECT TO public USING(bucket_id='avatars');
 END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='storage' AND tablename='objects' AND policyname='Authenticated users upload own avatar') THEN
  CREATE POLICY "Authenticated users upload own avatar" ON storage.objects FOR INSERT TO authenticated
   WITH CHECK(bucket_id='avatars' AND (storage.foldername(name))[1]=(SELECT auth.uid())::text);
 END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='storage' AND tablename='objects' AND policyname='Users can update own avatar') THEN
  CREATE POLICY "Users can update own avatar" ON storage.objects FOR UPDATE TO authenticated
   USING(bucket_id='avatars' AND (storage.foldername(name))[1]=(SELECT auth.uid())::text)
   WITH CHECK(bucket_id='avatars' AND (storage.foldername(name))[1]=(SELECT auth.uid())::text);
 END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='storage' AND tablename='objects' AND policyname='Users can delete own avatar') THEN
  CREATE POLICY "Users can delete own avatar" ON storage.objects FOR DELETE TO authenticated
   USING(bucket_id='avatars' AND (storage.foldername(name))[1]=(SELECT auth.uid())::text);
 END IF;
END $$;
