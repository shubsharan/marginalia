# Provider contracts

Planned boundaries for [the specification](../spec.md). Inject fetch functions in tests. Provider
responses are untrusted; only validated, permitted metadata crosses into storage.

## Shared limits and failures

Run one external call at a time per worker. Each call has a 15-second deadline and a 2 MiB response
limit enforced while reading, before JSON parsing. Operations have a 60-second deadline. There are
no automatic retries. Save safe local codes and validated provider request IDs, never arbitrary
exceptions, headers, raw responses, or provider error bodies.

Set `redirect: "error"` on every provider fetch. A redirect fails the operation without contacting
its destination; never forward credentials or replay the request there. Test this with local
redirect endpoints and fake credentials, asserting that the destination receives no request.

Honor valid `Retry-After` dates or seconds for rate/transient failures; otherwise set a 30-second
retry delay. Invalid JSON, oversized bodies, and malformed top-level arrays fail the operation.
Unusable source locations create rejected-result records. Missing/invalid optional metadata becomes
null with a warning code. Bound URLs to 4096 characters, titles to 500, author/publisher to 300,
request/notice IDs to 128, and query to 2000. Oversized optional values become null, not truncated
invented values.

## TMDB

Use `https://api.themoviedb.org/3` with `Authorization: Bearer TMDB_READ_ACCESS_TOKEN`. Use the API
Read Access Token, never a query-string secret. See
[application authentication](https://developer.themoviedb.org/docs/authentication-application).

1. For `film`, call `GET /search/movie`; for `television_series`, call `GET /search/tv`. If type is
   omitted, call both sequentially. Send trimmed input as `query`, `language=en-US`, `page=1`, and
   `include_adult=false`. Do not use multi-search, which also includes people.
2. Use search-result metadata directly. Do not call details, credits, external-ID, image, season,
   episode, or review endpoints. A typed input makes one call; an untyped input makes two. Both
   required searches must succeed before publishing any candidates for that input.
3. Retain at most 20 candidates per input. For two lists, alternate movie and TV entries starting
   with movie, preserving each list's order and consuming the remainder when one ends. Deduplicate
   by media type and ID before applying the cap. This is deterministic display order, not comparable
   relevance scores or automatic selection. Do not fetch additional pages. Flag limited resolution
   if either `total_pages > 1`, a response exceeds 20 entries, or the combined list is truncated;
   expose per-endpoint counts and query context.

Map endpoint `movie` to application type `film` and endpoint `tv` to `television_series`. Identity
is `(tmdb, movie|tv, positive integer id)`, never a bare numeric ID or title/year pair. A movie and
TV show with the same numeric ID are distinct works. Unexpected `media_type`, if present, must agree
with the endpoint. Malformed identity/type records fail the operation rather than silently reducing
an ambiguous result to one candidate.

Allowlist `id`, `title`, `original_title`, `release_date`, and `original_language` for movies; `id`,
`name`, `original_name`, `first_air_date`, `original_language`, and `origin_country` for TV. Map
title/name and original-title/name to common fields. Require a nonblank display name. Missing
optional values remain null. Validate dates as calendar dates in `YYYY-MM-DD` form; empty or invalid
dates become null with a safe warning. Bound language codes to 16 characters and country codes to 2
characters with at most 20 countries. Derive identity links from the validated namespace/ID. Save
retrieval time and the permitted snapshot, not a fabricated provider revision. Discard overview,
poster/backdrop paths, popularity, vote fields, and all unexpected prose. Search may match
alternative titles, but the response need not list those aliases.

Apply a supplied year locally to the movie `release_date` year or TV `first_air_date` year. Do not
send a provider year filter: retaining conflicting candidates lets callers inspect why none qualify.
This deliberately matches the returned primary release/first-air date, not every regional release or
episode year. Unknown or conflicting dates cannot satisfy a supplied year. Without a year, missing
dates remain visible and do not alone make a candidate ineligible. Every eligible candidate,
including a singleton, requires caller confirmation. Searches are bounded, English-localized, and
exclude adult results; no-match does not mean global absence.

HTTP 401 maps to `provider_credentials`, 403 to `provider_access`, 429 to `provider_rate_limit`,
400/422 to `provider_request_invalid`, and 5xx/network/timeouts to `provider_unavailable`. Other
unexpected non-success statuses fail visibly as `provider_response_invalid`. Validate the success
envelope and result array; `success: false` fails even on HTTP 200. Never save raw error messages or
authentication headers. Do not infer redirects, replacement IDs, or cross-provider matches. Saved
references remain readable if a provider record later disappears.

References: [movie search](https://developer.themoviedb.org/reference/search-movie),
[TV search](https://developer.themoviedb.org/reference/search-tv),
[finding data](https://developer.themoviedb.org/docs/finding-data), and
[errors](https://developer.themoviedb.org/docs/errors).

TMDB is not CC0 data. Record the applicable retention/display permission basis and attribution in
metadata policy before live use. Follow the [TMDB FAQ](https://developer.themoviedb.org/docs/faq)
for noncommercial attribution and commercial licensing. Include provider identity links in reads and
required attribution in operator documentation; this does not grant rights to Exa source bodies.

## Exa Search

Send `POST https://api.exa.ai/search` with `x-api-key: EXA_API_KEY` and JSON. Exactly these body
fields are allowed:

```json
{
  "query": "Heat 1995 film criticism analysis interviews themes filmmaking",
  "type": "auto",
  "numResults": 20
}
```

Construct one query per distinct work from its frozen representative selection: title, available
year, type, and the research-source intent shown above. Save the query/template version. Duplicate
inputs do not cause duplicate searches. Do not infer additional works from results.

Omit `contents`, `outputSchema`, `systemPrompt`, deep modes, category/domain filters, freshness, and
streaming. Do not call Contents, Answer, Agent, Snapshot, or Monitors.

Allowlist result `id`, `url`, `title`, `author`, and `publishedDate`; response `requestId` and safe
notice codes. Publisher remains null unless a future documented contract supplies it and metadata
policy allows it. Drop unexpected `text`, `highlights`, `summary`, `subpages`, and synthesized
output. Never log raw payloads, including parsing failures.

Associate each result with the selected work whose query returned it. This is unverified relevance.
Repeated normalized locations reuse one source ID and retain all selected-work associations. Keep
rank and notice codes such as `RESTRICTIONS_RELAXED`; neither proves exact relevance. Unknown
bounded notice codes remain inspectable with a generic local explanation; free-text provider
messages are not stored.

Exa has no pagination. Accept at most 20 results, expose counts, and flag truncation if extra
results arrive. Returning the cap means potentially limited coverage; fewer does not mean exhaustive
coverage. A valid empty array succeeds; a malformed response fails.

| Outcome                            | Safe error and action                                     |
| ---------------------------------- | --------------------------------------------------------- |
| HTTP 400                           | `provider_request_invalid`; correct adapter/configuration |
| HTTP 401                           | `provider_credentials`; configure a valid key             |
| HTTP 402                           | `provider_budget`; restore credits                        |
| HTTP 403                           | `provider_access`; resolve access restrictions            |
| HTTP 429                           | `provider_rate_limit`; retry after saved time             |
| HTTP 5xx, timeout, network failure | `provider_unavailable`; retry after saved time            |
| Invalid payload                    | `provider_response_invalid`; inspect compatibility        |

## Metadata permissions

`metadata-policy.json` records provider, reviewed date, permission-basis reference, retained fields,
and displayed fields. Only fields in this contract can be enabled. Unreviewed policy disables live
work for that provider with `metadata_policy_missing`. Fixtures use a clearly marked test policy.
Caller requests cannot override policy. Current display allowlists apply to historical output too.

Known restrictive notices reject affected metadata when retention/display is prohibited or unclear.
Response-wide restrictions fail the operation with `metadata_restricted`. Ordinary search-quality
notices remain visible. Do not fetch a source to investigate rights. Feature 2 owns that workflow.
Source-content processing/display permissions remain `unknown`, separate from metadata permission.
