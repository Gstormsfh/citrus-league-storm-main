// Proposal generator only. Does not call Google APIs, create channels or notify.
export const channels=[
 'projects/citrus-fantasy-prod/notificationChannels/17961179598089416027',
 'projects/citrus-fantasy-prod/notificationChannels/8361286418214240409',
];
const filter='resource.type="cloud_run_job" AND resource.labels.job_name="citrus-contextual-monitor" AND jsonPayload.event="contextual.independent.health"';
export function reviewDuePolicy(){return {
 displayName:'Citrus projections: internal review due within 24 hours',enabled:false,combiner:'OR',
 notificationChannels:[channels[0]],alertStrategy:{notificationRateLimit:{period:'86400s'},autoClose:'86400s'},
 documentation:{mimeType:'text/markdown',content:'An existing internal forecast review deadline is within 24 hours. This is not an external permission request. Inspect review_items in the matching monitor log. Engineering owns method/source and release review; Garrett owns manual injury/status confirmation. Revalidate the named assumptions using the revision-bound review process. Do not extend dates automatically. Existing expiry and failed-refresh alerts remain active. Runbook: scripts/ops/contextual-release/REVIEW-WINDOW.md.'},
 conditions:[{displayName:'Internal review deadline is approaching',conditionMatchedLog:{filter:filter+' AND jsonPayload.review_due=true'}}],
};}
export function monitoringProposal(){return {
 project:'citrus-fantasy-prod',deploymentReady:false,
 metric:{name:'citrus_contextual_monitor_heartbeat',description:'Independent projection monitor ran, healthy or unhealthy.',
  filter,metricDescriptor:{metricKind:'DELTA',valueType:'INT64',unit:'1'}},
 policies:[
  {displayName:'Citrus contextual projections: independent check failed',enabled:false,combiner:'OR',
   notificationChannels:[...channels],alertStrategy:{notificationRateLimit:{period:'1800s'},autoClose:'86400s'},
   conditions:[{displayName:'Independent checker reports unhealthy',conditionMatchedLog:{filter:filter+' AND jsonPayload.healthy=false'}}]},
  {displayName:'Citrus contextual projections: independent checker missing',enabled:false,combiner:'OR',
   notificationChannels:[...channels],conditions:[{displayName:'No monitor heartbeat for 20 minutes',conditionAbsent:{
    filter:'metric.type="logging.googleapis.com/user/citrus_contextual_monitor_heartbeat" AND resource.type="cloud_run_job"',
    duration:'1200s',aggregations:[{alignmentPeriod:'300s',perSeriesAligner:'ALIGN_SUM',crossSeriesReducer:'REDUCE_SUM'}],trigger:{count:1}}},
    {displayName:'Zero heartbeats over the last 20 minutes',conditionThreshold:{
     filter:'metric.type="logging.googleapis.com/user/citrus_contextual_monitor_heartbeat" AND resource.type="cloud_run_job"',
     comparison:'COMPARISON_LT',thresholdValue:1,duration:'60s',evaluationMissingData:'EVALUATION_MISSING_DATA_ACTIVE',
     aggregations:[{alignmentPeriod:'1200s',perSeriesAligner:'ALIGN_SUM',crossSeriesReducer:'REDUCE_SUM'}],trigger:{count:1}}}]},
 ],
 activationRequirements:[
  'Deploy the independent collector separately from the projection worker with read-only database access.',
  'Bind source/policy/immutable journal, execute output audits, and emit a healthy or unhealthy event each run.',
  'Verify an actual heartbeat metric point before enabling absence alerting.',
  'Verify existing notification delivery using permitted evidence; no unrequested test message.',
  'Exercise failed dependency, stale output, failed worker and missing monitor in an isolated test.',
  'Keep both policies disabled until collector and route evidence pass.',
 ],
};}
