# Alexa → Zentra shopping list

Say *"Alexa, dile a mi lista zentra que agregue leche"* and the item lands in a
Zentra shopping list.

## How it hangs together

```
Echo ──► Alexa skill (interaction model)
           └─► AWS Lambda (integrations/alexa/lambda)
                 └─► POST https://usezentra.app/api/alexa/add-item
                        header: x-api-key: <ALEXA_API_KEY>
```

**There is no account linking, and none is needed.** The server endpoint is
already bound to a single Zentra user through `ALEXA_USER_ID`, and authenticates
the caller with a shared secret instead of a user token. That is what keeps this
a few hours of work rather than a couple of days — OAuth account linking is
normally the bulk of an Alexa integration.

The trade-off: this skill is personal. Anyone speaking to *your* Echo adds to
*your* list. Supporting several people would mean real account linking.

## Server side — already done

`POST /alexa/add-item` is live in production and needs no changes. It:

- rejects anything without a matching `x-api-key` (403)
- normalises the item name and updates your item-memory, so repeat items learn
  your preferred spelling
- inserts at the top of the list
- accepts an optional `listId`, otherwise uses `ALEXA_DEFAULT_LIST_ID`

Request:

```json
{ "item": "plátanos maduros", "listId": "optional-uuid" }
```

Server env (already set in `.env.prod`): `ALEXA_API_KEY`, `ALEXA_USER_ID`,
`ALEXA_DEFAULT_LIST_ID`.

> Confirm `ALEXA_DEFAULT_LIST_ID` points at the list you actually want before
> building the skill — it was set previously and has not been re-checked.

## Steps remaining (~3–4 hours)

### 1. Lambda (~1 hour)

Create a Node 20 Lambda, paste `lambda/index.mjs` as the handler, and set:

| Variable | Value |
|---|---|
| `ZENTRA_API_BASE` | `https://usezentra.app/api` |
| `ZENTRA_API_KEY`  | same value as `ALEXA_API_KEY` on the server |
| `ZENTRA_LISTS`    | *optional* `{"casa":"<uuid>","oficina":"<uuid>"}` |

Leave `ZENTRA_LISTS` unset to always use the server's default list. With it set,
*"agrega leche a la lista de casa"* routes to that list; an unrecognised name is
refused out loud rather than filed somewhere unexpected.

No dependencies — it uses the built-in `fetch`, so the deployment package is
just the one file.

### 2. Skill (~45 min)

Alexa Developer Console → Create Skill → Custom → provision your own.

- Locale **Spanish (MX)** — or ES/US to match your Echo
- Import `interaction-model.es-MX.json` in the JSON Editor
- Endpoint → AWS Lambda ARN → paste the Lambda's ARN
- Add the skill ID as a trigger on the Lambda
- Build the model

Edit the `ZentraListName` slot values to your real list names, and keep them in
step with `ZENTRA_LISTS`.

### 3. Test (~1–1.5 hours)

Use the Console simulator first, then a real device. This is where the time
actually goes — tuning utterances so Spanish recognition catches item names
reliably.

**No certification, no publishing.** A skill left in Development works on any
Echo signed in to the same Amazon account, which avoids the store listing and
privacy-policy work entirely.

## Known snags

- **Invocation name.** Single words like "zentra" are usually rejected; the model
  ships with `mi lista zentra`. Change it if you prefer, but keep it multi-word.
- **`AMAZON.SearchQuery`** captures free text but needs a carrier phrase, which
  is why every sample utterance has words around `{item}`. It also cannot share
  an utterance with certain other slot types — if the build complains about the
  `{item} … {list}` samples, split them into a separate intent.
- **Accents are fine.** Verified end to end: `plátanos maduros para el niño`
  stores and normalises correctly. Send `Content-Type: application/json; charset=utf-8`,
  which the handler already does.

## Checks you can run now

```bash
# from this directory — verifies the accent folding used for list names
node lambda/fold.test.mjs

# against production: expect 403, proving the endpoint is live and guarded
curl -s -o /dev/null -w '%{http_code}\n' -X POST \
  https://usezentra.app/api/alexa/add-item \
  -H 'Content-Type: application/json' -d '{"item":"probe"}'
```
