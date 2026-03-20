---
name: content_query
triggers:
  - "where did i see"
  - "did i look at"
  - "did i read"
  - "that article"
  - "that video"
  - "that post"
  - "that thing"
  - "remember"
filters:
  - content_match
priority: relevance
---
When this skill activates, match the query terms against window titles and captured page text. Prioritize direct content matches over recency. Return the top 3 events with app name, window title, and timestamp, as a single sentence followed by supporting evidence.
