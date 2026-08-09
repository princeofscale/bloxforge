# The room, three ways

Roadmap A3. One 8×8 room — four walls, a floor, a doorway, fixed names, parent
paths, materials, colours, anchoring and seed — built by three routes:

| route | how |
|---|---|
| **A** | one `create_object` per part |
| **B** | one `mass_create_objects` |
| **C** | one `execute_luau` |

## What runs here, and what does not

The roadmap's measurement contract asks for seven things. Three of them are
deterministic given the routes and are computed by `payload-report.ts` with no
model, no key and no Studio: **serialized bytes for schemas, for tool arguments,
and for tool results**.

The other four — assistant/reasoning tokens, provider-reported cached input,
wall time, and task success — need a model, a provider key and a connected
Studio, at 20–30 repeats per route on a pinned build before anything is
concluded. They are not here. Three of seven categories is not the answer to
"which route is cheapest", and this directory does not present it as one.

## The deterministic half

```text
room payload, 28 parts (schemas + args + results; assistant tokens not included)
  route   calls   schema     args  results     total
  A          28      887     5398     2932      9217   many create_object
  B           1     1657     5439       69      7165   one mass_create_objects
  C           1     1985     1176       43      3204   one execute_luau
```

Three things in that table are worth saying out loud, because the obvious
reading of "fewer tool calls is cheaper" gets all three wrong.

**B does not win on arguments — it loses.** 5439 bytes against A's 5398. The
same 28 parts have to be described either way, and the batch wrapper costs a
little extra. Anyone expecting the batch tool to shrink the request was
expecting the wrong thing.

**B's advantage is entirely the response**: 2932 bytes down to 69, which is the
receipt from #98 doing its work. That is the whole of B's 2,052-byte lead, and
then some.

**B's schema is nearly double A's** — 1657 against 887. `mass_create_objects`
carries an object-array schema; `create_object` does not. Since schemas sit in
the cached prefix and arguments do not, B and A trade a recurring cost for a
per-call one, and which is better depends on how many rooms you build per
conversation. The roadmap's warning that tool count does not predict schema
footprint shows up here at the smallest possible scale.

**C is cheapest on the wire and not obviously cheapest.** 3204 bytes, because it
re-derives the geometry instead of listing it — but it is Luau the model had to
write correctly on the first try, it needs the broad `studio.execute`
capability, and what it did is not visible as a declarative diff. The bytes it
saves are real; so is everything it gives up. This is exactly the trade the
roadmap declines to settle on token count alone.

## Running it

```sh
npx tsx evals/room-benchmark/payload-report.ts            # report
npx tsx evals/room-benchmark/payload-report.ts --check    # gate on the baseline
npx tsx evals/room-benchmark/payload-report.ts --update   # re-baseline
```

`--check` fails on more than 2% drift **in either direction**. The payload is
deterministic, so a sudden drop is as likely to be a route that stopped doing
the work as a route that got cheaper.

Route B's result is measured *after* `bulkReceipt`, because that is what the
server does before the model sees it. Measuring it against a raw row-per-object
response would be measuring a version of BloxForge that no longer exists.
