---
name: time_query
triggers:
  - "yesterday"
  - "last night"
  - "this morning"
  - "earlier today"
  - "last week"
  - "last month"
  - "this week"
  - "this evening"
  - "around"
filters:
  - timestamp_range
priority: recency
---
When this skill activates, extract the time reference from the query using spaCy and convert it to a UTC timestamp range before retrieval. Apply that range as a hard filter to retrieval. Rank results by recency within that window. Return the top 3 events with app name, window title, and timestamp. Format the answer as a single natural language sentence followed by supporting evidence.
