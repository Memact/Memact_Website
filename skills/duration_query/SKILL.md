---
name: duration_query
triggers:
  - "how long"
  - "how much time"
  - "time spent"
  - "time on"
  - "hours"
  - "minutes"
filters:
  - timestamp_range
  - app_or_domain
priority: duration
---
When this skill activates, extract the target app or site and any time reference from the query using spaCy. Apply timestamp_range and app_or_domain as hard filters before retrieval. Estimate total duration within that window. Return one sentence with the duration and time scope, followed by supporting evidence.
