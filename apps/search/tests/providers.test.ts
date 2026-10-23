import { describe, expect, spyOn, test } from "bun:test";
import { LIMITS, type Config } from "../src/config.ts";
import { resolveTitle, type TmdbFetch } from "../src/providers/tmdb.ts";
import fixtures from "./fixtures/tmdb.json" with { type: "json" };
import {
  searchQuery,
  searchSources,
  type SearchFailure,
  type SearchSelection,
} from "../src/providers/exa.ts";
import exaFixtures from "./fixtures/exa.json" with { type: "json" };

const provider: Config["providers"]["tmdb"] = {
  credential: "fake-tmdb-token",
  policy: {
    provider: "tmdb",
    revision: "test-only-v1",
    reviewedAt: "2026-01-01",
    permissionBasis: "test-only fixture, no live permission",
  },
};

function fixtureFetch(calls: { url: URL; init: RequestInit }[]): TmdbFetch {
  return async (url, init) => {
    calls.push({ url, init });
    return Response.json(url.pathname.endsWith("movie") ? fixtures.movies : fixtures.tv);
  };
}

async function resolveSuccess(input: Parameters<typeof resolveTitle>[0]) {
  return (await resolveTitle(input))._unsafeUnwrap();
}

describe("TMDB resolution", () => {
  test("restrictive notices block response-wide metadata and omit restricted candidates", async () => {
    for (const code of [
      "METADATA_RESTRICTED",
      "RETENTION_PROHIBITED",
      "DISPLAY_PROHIBITED",
      "METADATA_RETENTION_PROHIBITED",
      "METADATA_DISPLAY_PROHIBITED",
    ]) {
      for (const field of ["notices", "warnings"]) {
        const result = await resolveTitle({
          input: { title: "Heat" },
          provider,
          fetch: async (url) =>
            Response.json({
              ...(url.pathname.endsWith("tv") ? fixtures.tv : fixtures.movies),
              ...(url.pathname.endsWith("tv") ? { [field]: [{ code, message: "FORBIDDEN" }] } : {}),
            }),
        });
        expect(result._unsafeUnwrapErr()).toEqual({ code: "metadata_restricted", retryAt: null });
        const allowed = await resolveSuccess({
          input: { title: "Heat", workType: "film" },
          provider,
          fetch: async () =>
            Response.json({
              results: [
                { id: 1, title: "FORBIDDEN", [field]: [{ code, message: "FORBIDDEN" }] },
                { id: 2, title: "Allowed", notices: [{ code: "UNKNOWN_QUALITY_NOTICE" }] },
              ],
            }),
        });
        expect(allowed.candidates.map((candidate) => candidate.providerId)).toEqual([2]);
        expect(allowed.endpoints[0]).toMatchObject({ returnedCount: 2, retainedCount: 1 });
        expect(JSON.stringify(allowed)).not.toContain("FORBIDDEN");
      }
    }
  });

  test("synchronous fetch exceptions become typed failures without raw secrets", async () => {
    const result = await resolveTitle({
      input: { title: "Heat", workType: "film" },
      provider,
      fetch: () => {
        throw new Error("fake-tmdb-token");
      },
    });
    expect(result._unsafeUnwrapErr()).toMatchObject({
      code: "provider_unavailable",
      retryAt: expect.any(String),
    });
    expect(JSON.stringify(result)).not.toContain("fake-tmdb-token");
  });

  test("the 15-second deadline includes streaming response consumption", async () => {
    const nativeTimeout = AbortSignal.timeout.bind(AbortSignal);
    const timeout = spyOn(AbortSignal, "timeout").mockImplementation(() => nativeTimeout(25));
    const server = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      fetch: () =>
        new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(new TextEncoder().encode('{"results":['));
            },
          }),
        ),
    });
    try {
      await expect(
        resolveTitle({
          input: { title: "Heat", workType: "film" },
          provider,
          fetch: (_url, init) => fetch(`http://127.0.0.1:${server.port}`, init),
        }),
      ).resolves.toMatchObject({ error: { code: "provider_unavailable" } });
      expect(timeout).toHaveBeenCalledWith(15_000);
    } finally {
      timeout.mockRestore();
      await server.stop(true);
    }
  });

  test("uses exact sequential searches, namespaces, local year checks and fixed metadata fields", async () => {
    const calls: { url: URL; init: RequestInit }[] = [];
    const result = await resolveSuccess({
      input: { title: " Heat ", year: 1995 },
      provider,
      fetch: fixtureFetch(calls),
    });
    expect(calls.map(({ url }) => url.origin + url.pathname)).toEqual([
      "https://api.themoviedb.org/3/search/movie",
      "https://api.themoviedb.org/3/search/tv",
    ]);
    for (const { url, init } of calls) {
      expect(Object.fromEntries(url.searchParams)).toEqual({
        query: "Heat",
        language: "en-US",
        page: "1",
        include_adult: "false",
      });
      expect(init.method).toBe("GET");
      expect(new Headers(init.headers).get("Authorization")).toBe("Bearer fake-tmdb-token");
      expect(init.redirect).toBe("error");
    }
    expect(result.candidates.map((c) => [c.mediaType, c.providerId, c.eligible])).toEqual([
      ["movie", 949, true],
      ["tv", 949, false],
      ["movie", 100, false],
      ["tv", 102, false],
      ["movie", 101, false],
    ]);
    expect(result.candidates[4]?.releaseDate).toBeNull();
    expect(result.limitFlags).toContain("resolution_limit_reached");
    expect(result.endpoints.map((e) => e.returnedCount)).toEqual([3, 2]);
    expect(JSON.stringify(result)).not.toMatch(/FORBIDDEN|overview|poster_path|revision/);
  });

  test("typed singleton and alternative-title matches stay candidates, missing dates remain eligible without a year", async () => {
    let calls = 0;
    const result = await resolveSuccess({
      input: { title: "Sen to Chihiro", workType: "film" },
      provider,
      fetch: async () => {
        calls++;
        return Response.json(fixtures.translated);
      },
    });
    expect(calls).toBe(1);
    expect(result.candidates[0]).toMatchObject({
      title: "Spirited Away",
      originalTitle: "Sen to Chihiro no kamikakushi",
      eligible: true,
    });
    const missing = await resolveSuccess({
      input: { title: "Heat", workType: "television_series" },
      provider,
      fetch: fixtureFetch([]),
    });
    expect(missing.candidates[1]).toMatchObject({ releaseDate: null, eligible: true });
  });

  test("deduplicates before a deterministic interleaved cap and exposes endpoint coverage", async () => {
    const result = await resolveSuccess({
      input: { title: "Heat" },
      provider,
      fetch: async () =>
        Response.json({
          page: 1,
          total_pages: 1,
          total_results: 30,
          results: Array.from({ length: 30 }, (_, i) => ({
            id: Math.floor(i / 2) + 1,
            title: "Film",
            name: "Series",
          })),
        }),
    });
    expect(result.candidates).toHaveLength(20);
    expect(result.candidates.slice(0, 4).map((c) => [c.mediaType, c.providerId])).toEqual([
      ["movie", 1],
      ["tv", 1],
      ["movie", 2],
      ["tv", 2],
    ]);
    expect(result.limitFlags).toContain("resolution_limit_reached");
    expect(result.endpoints.map((e) => e.returnedCount)).toEqual([30, 30]);
  });

  test.each([401, 403, 429, 400, 422, 500, 302])(
    "fails atomically when either search returns HTTP %s",
    async (status) => {
      let calls = 0;
      await expect(
        resolveTitle({
          input: { title: "Heat" },
          provider,
          fetch: async () => {
            calls++;
            return calls === 1
              ? Response.json(fixtures.movies)
              : Response.json({ message: "fake-tmdb-token" }, { status });
          },
        }),
      ).resolves.toMatchObject({
        error: {
          code:
            status === 401
              ? "provider_credentials"
              : status === 403
                ? "provider_access"
                : status === 429
                  ? "provider_rate_limit"
                  : [400, 422].includes(status)
                    ? "provider_request_invalid"
                    : status === 500
                      ? "provider_unavailable"
                      : "provider_response_invalid",
        },
      });
      expect(calls).toBe(2);
    },
  );

  test.each([
    { results: {} },
    { success: false, results: [] },
    { results: [{ id: 0, title: "Heat" }] },
    { results: [{ id: 1, title: " " }] },
    { results: [{ id: 1, title: "Heat", media_type: "tv" }] },
  ])("rejects invalid envelopes and identities", async (payload) => {
    await expect(
      resolveTitle({
        input: { title: "Heat", workType: "film" },
        provider,
        fetch: async () => Response.json(payload),
      }),
    ).resolves.toMatchObject({ error: { code: "provider_response_invalid" } });
  });

  test("drops adult results even if the provider ignores the filter", async () => {
    const result = await resolveSuccess({
      input: { title: "Heat", workType: "film" },
      provider,
      fetch: async () => Response.json({ results: [{ id: 1, title: "Adult", adult: true }] }),
    });
    expect(result.candidates).toEqual([]);
  });

  test("fails closed before dispatch for missing credentials or provider approval", async () => {
    let calls = 0;
    const fetch: TmdbFetch = async () => {
      calls++;
      throw new Error("unexpected");
    };
    const cases: [Config["providers"]["tmdb"], string][] = [
      [{ credential: null, policy: provider.policy }, "provider_credentials"],
      [{ credential: provider.credential, policy: null }, "metadata_policy_missing"],
    ];
    for (const [configuration, code] of cases) {
      await expect(
        resolveTitle({
          input: { title: "Heat", workType: "film" },
          provider: configuration,
          fetch,
        }),
      ).resolves.toMatchObject({ error: { code } });
    }
    expect(calls).toBe(0);
  });

  test("bounds response bytes, consumes streamed bodies, and redacts parse/network failures", async () => {
    for (const fetch of [
      async () =>
        new Response(JSON.stringify({ results: [], ignored: "x".repeat(LIMITS.providerMaxBytes) })),
      async () => new Response("fake-tmdb-token"),
      async () => {
        throw new Error("fake-tmdb-token");
      },
    ]) {
      const result = await resolveTitle({
        input: { title: "Heat", workType: "film" },
        provider,
        fetch,
      });
      expect(result.isErr()).toBe(true);
      expect(JSON.stringify(result)).not.toContain("fake-tmdb-token");
    }
  });

  test("native fetch rejects redirects without contacting the destination", async () => {
    let destinations = 0;
    const target = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      fetch: () => {
        destinations++;
        return Response.json(fixtures.movies);
      },
    });
    const redirect = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      fetch: () => Response.redirect(`http://127.0.0.1:${target.port}/secret`),
    });
    try {
      await expect(
        resolveTitle({
          input: { title: "Heat", workType: "film" },
          provider,
          fetch: (_url, init) => fetch(`http://127.0.0.1:${redirect.port}/search`, init),
        }),
      ).resolves.toMatchObject({ error: { code: "provider_unavailable" } });
      expect(destinations).toBe(0);
    } finally {
      await redirect.stop(true);
      await target.stop(true);
    }
  });
});

const exaProvider: Config["providers"]["exa"] = {
  credential: "fake-exa-key",
  policy: {
    provider: "exa",
    revision: "test-only-v1",
    reviewedAt: "2026-01-01",
    permissionBasis: "test-only fixture, no live permission",
  },
};
const selection: SearchSelection = { title: "Heat", releaseDate: "1995-12-15", workType: "film" };

describe("Exa metadata search", () => {
  test("one frozen-selection query uses only the exact native metadata Search fields", async () => {
    const calls: { url: URL; init: RequestInit }[] = [];
    const result = (
      await searchSources({
        selection,
        provider: exaProvider,
        fetch: async (url, init) => {
          calls.push({ url, init });
          return Response.json(exaFixtures);
        },
      })
    )._unsafeUnwrap();
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url.href).toBe("https://api.exa.ai/search");
    expect(calls[0]?.init).toMatchObject({ method: "POST", redirect: "error" });
    expect(new Headers(calls[0]?.init.headers).get("x-api-key")).toBe("fake-exa-key");
    expect(new Headers(calls[0]?.init.headers).get("Content-Type")).toBe("application/json");
    expect(JSON.parse(String(calls[0]?.init.body))).toEqual({
      query: "Heat 1995 film criticism analysis interviews themes filmmaking",
      type: "auto",
      numResults: 20,
    });
    expect(
      searchQuery({ title: "The Wire", releaseDate: null, workType: "television_series" }),
    ).toBe("The Wire television series criticism analysis interviews themes filmmaking");
    expect(result).toMatchObject({
      returnedCount: 4,
      providerRequestId: "fixture-exa-request",
      metadataPolicyRevision: "test-only-v1",
      noticeCodes: ["RESTRICTIONS_RELAXED", "UNKNOWN_QUALITY_NOTICE"],
      rejections: [{ ordinal: 3, reasonCode: "invalid_source_url" }],
    });
    expect(result.sources).toHaveLength(3);
    expect(result.sources[0]).toMatchObject({
      ordinal: 0,
      originalUrl: exaFixtures.results[0]?.url,
      normalizedUrl: "https://example.org/Film/Heat?b=2&a=1",
      sourceHost: "example.org",
      providerResultId: "result-1",
      title: "Heat and the city",
      author: "A Critic",
      publisher: null,
      publicationDate: "2020-02-29T12:30:00Z",
      observedAt: expect.any(String),
      warningCodes: [],
    });
    expect(result.sources[1]?.normalizedUrl).toBe("http://example.org/Film/Heat?b=2&a=1");
    expect(result.sources[2]?.normalizedUrl).toBe(result.sources[0]?.normalizedUrl);
    expect(JSON.stringify(result)).not.toMatch(/FORBIDDEN|subpages|highlights|summary|output/);
  });

  test("empty results succeed and cap/truncation remain visible", async () => {
    for (const count of [0, 19, 20, 21]) {
      const result = (
        await searchSources({
          selection,
          provider: exaProvider,
          fetch: async () =>
            Response.json({
              results: Array.from({ length: count }, (_, i) => ({
                url: `https://example.org/${i}`,
              })),
            }),
        })
      )._unsafeUnwrap();
      expect(result.returnedCount).toBe(count);
      expect(result.sources).toHaveLength(Math.min(20, count));
      expect(result.sources.map((source) => source.ordinal)).toEqual(
        Array.from({ length: Math.min(20, count) }, (_, ordinal) => ordinal),
      );
      expect(result.limitFlags).toEqual(
        count < 20
          ? []
          : count === 20
            ? ["result_limit_reached"]
            : ["result_limit_reached", "search_results_truncated"],
      );
    }
  });

  test.each([
    "http://localhost/a",
    "http://film.localhost/a",
    "http://film.local/a",
    "http://film.home.arpa/a",
    "http://film.localdomain/a",
    "http://internal/a",
    "http://film.internal/a",
    "http://127.0.0.1/a",
    "http://2130706433/a",
    "http://0x7f000001/a",
    "http://[::1]/a",
    "http://user:secret@example.org/a",
    "file:///film",
    "ftp://example.org/a",
    "https://example.org/\nsecret",
    "https://example.org/\u0000secret",
    "https://example.org/" + "x".repeat(4096),
    "https://example.org/" + "\u00e9".repeat(1000),
    "not a URL",
    "https://example.org\\@localhost/a",
    "http://name.test/a",
    "http://name.onion/a",
  ])("rejects unusable source locations without retaining raw metadata", async (url) => {
    const result = (
      await searchSources({
        selection,
        provider: exaProvider,
        fetch: async () => Response.json({ results: [{ url, title: "private metadata" }] }),
      })
    )._unsafeUnwrap();
    expect(result.sources).toEqual([]);
    expect(result.rejections).toEqual([{ ordinal: 0, reasonCode: "invalid_source_url" }]);
    expect(JSON.stringify(result)).not.toContain("private metadata");
  });

  test("missing, malformed and oversized optional metadata stays null with safe warnings", async () => {
    const result = (
      await searchSources({
        selection,
        provider: exaProvider,
        fetch: async () =>
          Response.json({
            requestId: "x".repeat(129),
            results: [
              {
                url: "https://example.org/a",
                id: 7,
                title: "x".repeat(501),
                author: "x".repeat(301),
                publishedDate: "2023-02-29T12:00:00Z",
                publisher: "host is not a publisher",
              },
            ],
          }),
      })
    )._unsafeUnwrap();
    expect(result.providerRequestId).toBeNull();
    expect(result.sources[0]).toMatchObject({
      providerResultId: null,
      title: null,
      author: null,
      publisher: null,
      publicationDate: null,
    });
    expect(result.sources[0]?.warningCodes).toEqual([
      "missing_or_invalid_id",
      "missing_or_invalid_title",
      "missing_or_invalid_author",
      "missing_or_invalid_publishedDate",
    ]);
  });

  test("restrictive notices fail response-wide or reject only their affected metadata", async () => {
    for (const code of [
      "METADATA_RESTRICTED",
      "RETENTION_PROHIBITED",
      "DISPLAY_PROHIBITED",
      "METADATA_RETENTION_PROHIBITED",
      "METADATA_DISPLAY_PROHIBITED",
    ]) {
      expect(
        (
          await searchSources({
            selection,
            provider: exaProvider,
            fetch: async () =>
              Response.json({
                results: [{ url: "https://example.org/a" }],
                notices: [{ code, message: "FORBIDDEN" }],
              }),
          })
        )._unsafeUnwrapErr(),
      ).toEqual({ code: "metadata_restricted", retryAt: null });
      const result = (
        await searchSources({
          selection,
          provider: exaProvider,
          fetch: async () =>
            Response.json({
              results: [
                { url: "https://example.org/a", notices: [{ code }] },
                { url: "https://example.org/b" },
              ],
            }),
        })
      )._unsafeUnwrap();
      expect(result.sources.map((source) => source.ordinal)).toEqual([1]);
      expect(result.rejections).toEqual([{ ordinal: 0, reasonCode: "metadata_restricted" }]);
    }
  });

  test("notice codes are bounded tokens and free-text messages never become codes", async () => {
    const result = (
      await searchSources({
        selection,
        provider: exaProvider,
        fetch: async () =>
          Response.json({
            results: [],
            notices: [
              { code: "NEW_QUALITY_CODE", message: "FORBIDDEN" },
              { code: "future_quality_code.v2", message: "FORBIDDEN" },
              { code: "FORBIDDEN free text" },
              { code: "A".repeat(129) },
              { message: "FORBIDDEN" },
              "FORBIDDEN free text",
            ],
          }),
      })
    )._unsafeUnwrap();
    expect(result.noticeCodes).toEqual(["NEW_QUALITY_CODE", "future_quality_code.v2"]);
    expect(JSON.stringify(result)).not.toContain("FORBIDDEN");
  });

  test("notice codes exceeding the persisted JSON limit fail safely", async () => {
    for (const scoped of [false, true]) {
      const notices = Array.from({ length: 50 }, (_, i) => ({
        code: `NOTICE_${i}_${"A".repeat(100)}`,
      }));
      const result = await searchSources({
        selection,
        provider: exaProvider,
        fetch: async () =>
          Response.json(
            scoped
              ? { results: [{ url: "https://example.org/a", notices }] }
              : { results: [], notices },
          ),
      });
      expect(result._unsafeUnwrapErr()).toEqual({
        code: "provider_response_invalid",
        retryAt: null,
      });
    }
  });

  test.each([
    [400, "provider_request_invalid"],
    [401, "provider_credentials"],
    [402, "provider_budget"],
    [403, "provider_access"],
    [429, "provider_rate_limit"],
    [500, "provider_unavailable"],
    [302, "provider_response_invalid"],
  ] satisfies [number, SearchFailure["code"]][])(
    "maps HTTP %s without provider error bodies",
    async (status, code) => {
      const result = await searchSources({
        selection,
        provider: exaProvider,
        fetch: async () =>
          new Response("FORBIDDEN fake-exa-key", {
            status: Number(status),
            headers: { "Retry-After": "120" },
          }),
      });
      expect(result._unsafeUnwrapErr().code).toBe(code);
      if (result._unsafeUnwrapErr().retryAt !== null)
        expect(Date.parse(result._unsafeUnwrapErr().retryAt ?? "") - Date.now()).toBeGreaterThan(
          110_000,
        );
      expect(JSON.stringify(result)).not.toMatch(/FORBIDDEN|fake-exa-key/);
    },
  );

  test("approval and credentials gate dispatch", async () => {
    let calls = 0;
    for (const [configuration, code] of [
      [{ credential: null, policy: exaProvider.policy }, "provider_credentials"],
      [{ credential: exaProvider.credential, policy: null }, "metadata_policy_missing"],
    ] satisfies [Config["providers"]["exa"], SearchFailure["code"]][]) {
      const result = await searchSources({
        selection,
        provider: configuration,
        fetch: async () => {
          calls++;
          return Response.json({ results: [] });
        },
      });
      expect(result._unsafeUnwrapErr().code).toBe(code);
    }
    expect(calls).toBe(0);
  });

  test("Retry-After dates are honored and invalid retry headers use the configured delay", async () => {
    const future = new Date(Date.now() + 120_000).toUTCString();
    for (const header of [future, "invalid", "-1", "9".repeat(1000)]) {
      const before = Date.now();
      const failure = (
        await searchSources({
          selection,
          provider: exaProvider,
          fetch: async () =>
            new Response(null, { status: 503, headers: { "Retry-After": header } }),
        })
      )._unsafeUnwrapErr();
      const date = Date.parse(failure.retryAt ?? "");
      expect(date).toBeGreaterThanOrEqual(
        header === future ? Date.parse(future) : before + LIMITS.retryDelayMs,
      );
      expect(date).toBeLessThanOrEqual(
        header === future ? Date.parse(future) : Date.now() + LIMITS.retryDelayMs,
      );
    }
  });

  test("malformed, oversized, network and synchronous exceptions return safe typed failures", async () => {
    for (const fetch of [
      async () => Response.json({ results: {} }),
      async () => Response.json({}),
      async () => new Response("FORBIDDEN fake-exa-key"),
      async () =>
        new Response(JSON.stringify({ results: [], text: "x".repeat(LIMITS.providerMaxBytes) })),
      async () => {
        throw new Error("FORBIDDEN fake-exa-key");
      },
      () => {
        throw new Error("FORBIDDEN fake-exa-key");
      },
    ]) {
      const result = await searchSources({ selection, provider: exaProvider, fetch });
      expect(result.isErr()).toBe(true);
      expect(JSON.stringify(result)).not.toMatch(/FORBIDDEN|fake-exa-key/);
    }
  });

  test("native fetch streaming timeout includes response consumption", async () => {
    const nativeTimeout = AbortSignal.timeout.bind(AbortSignal);
    const timeout = spyOn(AbortSignal, "timeout").mockImplementation(() => nativeTimeout(25));
    const server = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      fetch: () =>
        new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(new TextEncoder().encode('{"results":['));
            },
          }),
        ),
    });
    try {
      expect(
        (
          await searchSources({
            selection,
            provider: exaProvider,
            fetch: (_url, init) => fetch(`http://127.0.0.1:${server.port}`, init),
          })
        )._unsafeUnwrapErr().code,
      ).toBe("provider_unavailable");
      expect(timeout).toHaveBeenCalledWith(15_000);
    } finally {
      timeout.mockRestore();
      await server.stop(true);
    }
  });

  test("native fetch redirect cannot send credentials to the destination", async () => {
    let destinations = 0;
    const target = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      fetch: () => {
        destinations++;
        return Response.json({ results: [] });
      },
    });
    const redirect = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      fetch: () => Response.redirect(`http://127.0.0.1:${target.port}/secret`),
    });
    try {
      expect(
        (
          await searchSources({
            selection,
            provider: exaProvider,
            fetch: (_url, init) => fetch(`http://127.0.0.1:${redirect.port}/search`, init),
          })
        )._unsafeUnwrapErr().code,
      ).toBe("provider_unavailable");
      expect(destinations).toBe(0);
    } finally {
      await redirect.stop(true);
      await target.stop(true);
    }
  });
});
