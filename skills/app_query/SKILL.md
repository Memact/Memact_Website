---
name: app_query
triggers:
  - "when did i last use"
  - "last used"
  - "last time i used"
  - "last open"
  - "last opened"
  - "last visit"
  - "last visited"
filters:
  - app_or_domain
priority: recency
---
When this skill activates, extract the app name or site domain from the query using spaCy. Apply an app_name or domain filter before retrieval. Rank results by most recent occurrence. Return the single most recent event with app name, window title, and timestamp in one sentence, followed by supporting evidence.
