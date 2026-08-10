import { describe, expect, it } from "vitest";
import { encodeLine, isRpcRequest, parseLines } from "./protocol.js";

describe("protocol", () => {
  it("codifica un valor como una línea JSON terminada en \\n", () => {
    expect(encodeLine({ id: 1, result: "ok" })).toBe('{"id":1,"result":"ok"}\n');
  });

  it("parsea varias líneas completas y deja el remanente incompleto en rest", () => {
    const { messages, rest } = parseLines('{"id":1}\n{"id":2}\n{"id":3');
    expect(messages).toEqual([{ id: 1 }, { id: 2 }]);
    expect(rest).toBe('{"id":3');
  });

  it("ignora líneas vacías", () => {
    const { messages, rest } = parseLines('{"id":1}\n\n{"id":2}\n');
    expect(messages).toEqual([{ id: 1 }, { id: 2 }]);
    expect(rest).toBe("");
  });

  it("identifica una RpcRequest válida", () => {
    expect(isRpcRequest({ id: 1, method: "listSessions" })).toBe(true);
    expect(isRpcRequest({ id: 1 })).toBe(false);
    expect(isRpcRequest({ method: "x" })).toBe(false);
    expect(isRpcRequest(null)).toBe(false);
  });
});
