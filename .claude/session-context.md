# Session Context
Updated: 2026-08-14T13:07:40Z
Session: a2fb5034-28bf-4c7a-9a10-0b96d3ad4bd7

## Last Assistant Message
Docs committed as `3741e67`. The code changes (`OrdersService`, adapter removal, migration fix, dedup services, new test specs) are still uncommitted in the working tree — say the word when you want that as the feature commit.

## Git State
Branch: main
Uncommitted changes: 30
 .../api/src/radiology/radiology-billing.adapter.ts |  51 -------
 ...diology-requisition-number-generator.service.ts |  26 +---
 .../src/radiology/radiology-workflow.service.ts    |  30 ++---
 .../apps/api/src/radiology/radiology.module.ts     |   4 +-
 26 files changed, 142 insertions(+), 654 deletions(-)
