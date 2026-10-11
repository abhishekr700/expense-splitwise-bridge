import { describe, it, beforeEach, afterEach, mock } from "node:test";
import assert from "node:assert/strict";

process.env.NODE_ENV = "test";

const {
    callApi,
    getGroups,
    getAllExpenses,
    populateGroupMappings,
    groupIdToName,
    groupNameToId,
    isReadOnly,
    run,
    getSessionCookie,
    saveSessionCookie
} = await import("../import.js");

describe("Splitwise Importer API and Group Mapping Tests", () => {
    const originalEnvApiKey = process.env.SPLITWISE_API_KEY;
    const originalEnvSessionCookie = process.env.SPLITWISE_SESSION_COOKIE;
    const originalEnvCookiePath = process.env.SPLITWISE_COOKIE_PATH;

    beforeEach(() => {
        process.env.SPLITWISE_API_KEY = "test-api-key";
        delete process.env.SPLITWISE_SESSION_COOKIE;
        process.env.SPLITWISE_COOKIE_PATH = "/tmp/non_existent_test_cookie_path.txt";
    });

    afterEach(() => {
        if (originalEnvApiKey !== undefined) {
            process.env.SPLITWISE_API_KEY = originalEnvApiKey;
        } else {
            delete process.env.SPLITWISE_API_KEY;
        }
        if (originalEnvSessionCookie !== undefined) {
            process.env.SPLITWISE_SESSION_COOKIE = originalEnvSessionCookie;
        } else {
            delete process.env.SPLITWISE_SESSION_COOKIE;
        }
        if (originalEnvCookiePath !== undefined) {
            process.env.SPLITWISE_COOKIE_PATH = originalEnvCookiePath;
        } else {
            delete process.env.SPLITWISE_COOKIE_PATH;
        }
        mock.reset();
    });

    it("throws a clear error when SPLITWISE_API_KEY is missing", async () => {
        delete process.env.SPLITWISE_API_KEY;
        delete process.env.SPLITWISE_SESSION_COOKIE;
        await assert.rejects(
            async () => {
                await callApi("get_groups");
            },
            {
                name: "Error",
                message: /SPLITWISE_API_KEY is not set/
            }
        );
    });

    it("throws a descriptive error on HTTP 401 Unauthorized response", async () => {
        mock.method(globalThis, "fetch", async () => {
            return new Response(JSON.stringify({ error: "Invalid API request: you are not logged in" }), {
                status: 401,
                statusText: "Unauthorized",
                headers: { "Content-Type": "application/json" }
            });
        });

        await assert.rejects(
            async () => {
                await callApi("get_groups");
            },
            {
                name: "Error",
                message: /Splitwise API error \(401 Unauthorized\) on endpoint 'get_groups': Invalid API request: you are not logged in/
            }
        );
    });

    it("throws a descriptive error on HTTP 429 Too Many Requests response", async () => {
        mock.method(globalThis, "fetch", async () => {
            return new Response(JSON.stringify({ error: "Too Many Requests" }), {
                status: 429,
                statusText: "Too Many Requests",
                headers: { "Content-Type": "application/json" }
            });
        });

        await assert.rejects(
            async () => {
                await callApi("get_groups");
            },
            {
                name: "Error",
                message: /Splitwise API error \(429 Too Many Requests\) on endpoint 'get_groups': Too Many Requests/
            }
        );
    });

    it("throws a descriptive error on HTTP 502 non-JSON / HTML response", async () => {
        mock.method(globalThis, "fetch", async () => {
            return new Response("<html><head><title>502 Bad Gateway</title></head><body>Bad Gateway</body></html>", {
                status: 502,
                statusText: "Bad Gateway",
                headers: { "Content-Type": "text/html" }
            });
        });

        await assert.rejects(
            async () => {
                await callApi("get_groups");
            },
            {
                name: "Error",
                message: /Splitwise API \(get_groups\) returned non-JSON response \(502 Bad Gateway\)/
            }
        );
    });

    it("throws an error in getGroups when groups property is missing or not an array", async () => {
        mock.method(globalThis, "fetch", async () => {
            return new Response(JSON.stringify({ not_groups: [] }), {
                status: 200,
                statusText: "OK",
                headers: { "Content-Type": "application/json" }
            });
        });

        await assert.rejects(
            async () => {
                await getGroups();
            },
            {
                name: "Error",
                message: /Expected 'groups' array from Splitwise API/
            }
        );
    });

    it("throws an error in getAllExpenses when expenses property is missing or not an array", async () => {
        mock.method(globalThis, "fetch", async () => {
            return new Response(JSON.stringify({ not_expenses: [] }), {
                status: 200,
                statusText: "OK",
                headers: { "Content-Type": "application/json" }
            });
        });

        await assert.rejects(
            async () => {
                await getAllExpenses();
            },
            {
                name: "Error",
                message: /Expected 'expenses' array from Splitwise API/
            }
        );
    });

    it("populates group mappings correctly when getGroups returns valid groups", async () => {
        const mockGroups = [
            { id: 0, name: "Non-group expenses" },
            { id: 12345, name: "House Rent & Utilities" }
        ];

        mock.method(globalThis, "fetch", async () => {
            return new Response(JSON.stringify({ groups: mockGroups }), {
                status: 200,
                statusText: "OK",
                headers: { "Content-Type": "application/json" }
            });
        });

        await populateGroupMappings();

        assert.equal(groupIdToName[0], "Non-group expenses");
        assert.equal(groupIdToName[12345], "House Rent & Utilities");
        assert.equal(groupNameToId["Non-group expenses"], 0);
        assert.equal(groupNameToId["House Rent & Utilities"], 12345);
    });

    it("respects DRY_RUN / READ_ONLY flags and skips DB inserts and Uptime Kuma ping", async () => {
        process.env.DRY_RUN = "true";
        assert.equal(isReadOnly(), true);

        const fetchedUrls = [];
        const postRequests = [];

        mock.method(globalThis, "fetch", async (url, options = {}) => {
            const urlStr = url.toString();
            fetchedUrls.push(urlStr);
            if (options.method === "POST") {
                postRequests.push({ url: urlStr, body: options.body });
            }

            if (urlStr.includes("get_groups")) {
                return new Response(JSON.stringify({ groups: [{ id: 0, name: "Non-group expenses" }] }), {
                    status: 200,
                    headers: { "Content-Type": "application/json" }
                });
            }

            if (urlStr.includes("get_expenses")) {
                return new Response(JSON.stringify({
                    expenses: [
                        {
                            id: 9999,
                            description: "Groceries",
                            date: "2026-10-10",
                            group_id: 0,
                            users: [{ user_id: 23804942, owed_share: "25.50" }]
                        }
                    ]
                }), {
                    status: 200,
                    headers: { "Content-Type": "application/json" }
                });
            }

            if (urlStr.includes("get_expense?expenseName=")) {
                return new Response(JSON.stringify({ categoryId: 10 }), {
                    status: 200,
                    headers: { "Content-Type": "application/json" }
                });
            }

            if (urlStr.includes("checkExpenseExistsBySplitwiseId")) {
                return new Response(JSON.stringify({ exists: false }), {
                    status: 200,
                    headers: { "Content-Type": "application/json" }
                });
            }

            return new Response("OK", { status: 200 });
        });

        await run();

        // Must NOT send any POST request to insert expense
        assert.equal(postRequests.length, 0);

        // Must NOT ping Uptime Kuma
        const uptimeKumaPing = fetchedUrls.some(u => process.env.UPTIME_KUMA_URL && u.includes(process.env.UPTIME_KUMA_URL));
        assert.equal(uptimeKumaPing, false);

        delete process.env.DRY_RUN;
    });

    it("uses SPLITWISE_SESSION_COOKIE in headers and auto-updates on Set-Cookie response", async () => {
        delete process.env.SPLITWISE_API_KEY;
        process.env.SPLITWISE_SESSION_COOKIE = "user_credentials=old_val; _splitwise_session=old_sess";

        let capturedHeaders = null;
        mock.method(globalThis, "fetch", async (url, options) => {
            capturedHeaders = options.headers;
            const resHeaders = new Headers();
            resHeaders.append("Content-Type", "application/json");
            resHeaders.append("Set-Cookie", "_splitwise_session=new_renewed_sess; expires=Mon, 15 Nov 2027; path=/");
            return new Response(JSON.stringify({ groups: [] }), {
                status: 200,
                headers: resHeaders
            });
        });

        const groups = await getGroups();
        assert.deepEqual(groups, []);
        assert.equal(capturedHeaders["Authorization"], undefined);
        assert.equal(capturedHeaders["Cookie"], "user_credentials=old_val; _splitwise_session=old_sess");
        assert.ok(process.env.SPLITWISE_SESSION_COOKIE.includes("_splitwise_session=new_renewed_sess"));
        assert.ok(process.env.SPLITWISE_SESSION_COOKIE.includes("user_credentials=old_val"));
    });

    it("reads cookie from SPLITWISE_COOKIE_PATH when file exists, prioritizing over env var", async () => {
        const fs = await import("fs");
        const tmpPath = `/tmp/test_splitwise_cookie_${Date.now()}.txt`;
        fs.writeFileSync(tmpPath, "user_credentials=file_val; _splitwise_session=file_sess", "utf8");

        process.env.SPLITWISE_COOKIE_PATH = tmpPath;
        process.env.SPLITWISE_SESSION_COOKIE = "user_credentials=env_val";

        const cookie = getSessionCookie();
        assert.equal(cookie, "user_credentials=file_val; _splitwise_session=file_sess");

        fs.unlinkSync(tmpPath);
    });

    it("persists renewed cookie to SPLITWISE_COOKIE_PATH file", async () => {
        const fs = await import("fs");
        const tmpPath = `/tmp/test_splitwise_save_cookie_${Date.now()}.txt`;
        process.env.SPLITWISE_COOKIE_PATH = tmpPath;
        process.env.NODE_ENV = "production"; // temporarily enable file writing

        try {
            saveSessionCookie("user_credentials=persisted_val; _splitwise_session=persisted_sess");
            assert.ok(fs.existsSync(tmpPath));
            const content = fs.readFileSync(tmpPath, "utf8");
            assert.equal(content, "user_credentials=persisted_val; _splitwise_session=persisted_sess");
        } finally {
            process.env.NODE_ENV = "test";
            if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
        }
    });
});
