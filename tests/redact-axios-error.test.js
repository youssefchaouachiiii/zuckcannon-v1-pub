import { inspect } from "node:util";
import { redactAxiosError } from "../backend/utils/redact-axios-error.js";

const TOKEN = "EAALIVEtokenSECRET1234567890";

// axios error where the token rides in the query string / form body (params + url + form data)
function fakeQueryError() {
  const config = {
    method: "get",
    url: `https://graph.facebook.com/v24.0/me/adaccounts?fields=id&access_token=${TOKEN}`,
    params: { fields: "id", access_token: TOKEN },
    data: `name=Test&access_token=${TOKEN}`,
    headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
  };
  const request = {
    path: `/v24.0/me/adaccounts?fields=id&access_token=${TOKEN}`,
    _header: `GET /v24.0/me/adaccounts?access_token=${TOKEN} HTTP/1.1\r\n`,
  };
  const err = new Error("Request failed with status code 400");
  err.code = "ERR_BAD_REQUEST";
  err.config = config;
  err.request = request;
  err.response = { status: 400, data: { error: { message: "Invalid parameter" } }, config, request };
  return err;
}

// axios error where the token rides in a JSON request body (config.data is a JSON string) —
// this is how the video/image upload POSTs send it (the vector the first cut missed).
function fakeJsonBodyError() {
  const config = {
    method: "post",
    url: "https://graph.facebook.com/v24.0/123456789/videos",
    data: JSON.stringify({ upload_phase: "start", file_size: 1024, access_token: TOKEN }),
    headers: { "Content-Type": "application/json" },
  };
  const request = { path: "/v24.0/123456789/videos" };
  const err = new Error("Request failed with status code 400");
  err.config = config;
  err.request = request;
  err.response = { status: 400, data: { error: { message: "bad upload" } }, config, request };
  return err;
}

describe("redactAxiosError", () => {
  test("strips the token from query/form/url/params/headers/request-path vectors", () => {
    const err = redactAxiosError(fakeQueryError());
    const dump = inspect(err, { depth: 6 });
    expect(dump).not.toContain(TOKEN);
    expect(dump).toContain("[REDACTED]");
  });

  test("strips the token from a JSON request body (config.data string)", () => {
    const err = redactAxiosError(fakeJsonBodyError());
    const dump = inspect(err, { depth: 6 });
    expect(dump).not.toContain(TOKEN);
    expect(err.config.data).toContain("[REDACTED]");
  });

  test("strips the token from an object request body (config.data object)", () => {
    const err = new Error("x");
    err.config = { url: "https://graph.facebook.com/x", data: { access_token: TOKEN, foo: "bar" } };
    redactAxiosError(err);
    expect(err.config.data.access_token).toBe("[REDACTED]");
    expect(inspect(err, { depth: 6 })).not.toContain(TOKEN);
  });

  test("neutralizes a multipart/stream body so even deep inspection can't leak it", () => {
    const fd = { _streams: [`Content-Disposition: form-data; name="access_token"\r\n\r\n${TOKEN}`], pipe() {} };
    const err = new Error("upload failed");
    err.config = { url: "https://graph.facebook.com/v24.0/123/videos", data: fd };
    redactAxiosError(err);
    expect(err.config.data).toBe("[multipart body omitted]");
    expect(inspect(err, { depth: 10 })).not.toContain(TOKEN);
  });

  test("preserves useful debug info (message, status, Meta error body)", () => {
    const err = redactAxiosError(fakeQueryError());
    expect(err.message).toBe("Request failed with status code 400");
    expect(err.response.status).toBe(400);
    expect(err.response.data.error.message).toBe("Invalid parameter");
  });

  test("drops the raw ClientRequest (err.request + err.response.request)", () => {
    const err = redactAxiosError(fakeQueryError());
    expect(err.request).toBeUndefined();
    expect(err.response.request).toBeUndefined();
  });

  test("no-ops safely on non-axios values", () => {
    const plain = new Error("plain failure");
    expect(redactAxiosError(plain)).toBe(plain);
    expect(inspect(redactAxiosError(plain))).toContain("plain failure");
    expect(redactAxiosError(null)).toBe(null);
    expect(redactAxiosError("string")).toBe("string");
  });
});
