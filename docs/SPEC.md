# Spec

The globe shows relationships: a lab originates a model, and providers serve that model somewhere else.

## This version

- Dark globe, zoomed out, drag to orbit, scroll to zoom.
- Lab icons at approximate headquarters. No scrolling directory.
- A lab search and a Last 15 days switch.
- Click a lab: its newest models fan out around that icon. They are not placed on other cities.
- Click a model: providers that serve it appear at their own approximate headquarters, when this repo has coordinates.
- Latest labs, models, and providers use a sonar ripple.
- Icons distinguish lab, model, and provider.
- A card names the selection, release date, capability flags, and a short provider list.
- `/api/catalog` fails closed. The UI does not invent labs, models, or pins.

## Later

- Capability, price, and timeline layers on the same Lab → Model → Host graph.
- Per-model pages and a fuller host directory.

## Out of scope

- Treating every TOML file as a map pin.
- Live geocoding, accounts, or analytics.
