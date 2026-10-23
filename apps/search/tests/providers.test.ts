import { describe, expect, spyOn, test } from "bun:test";
import { LIMITS, type Config } from "../src/config.ts";
import { resolveTitle, type TmdbFetch } from "../src/providers/tmdb.ts";
import fixtures from "./fixtures/tmdb.json" with { type: "json" };

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
