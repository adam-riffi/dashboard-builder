import { expect, it, vi } from "vitest";

const registerMap = vi.fn();
vi.mock("echarts/core", async (original) => ({
  ...(await original<typeof import("echarts/core")>()),
  registerMap: (...args: unknown[]) => registerMap(...args),
}));

it("loads the world map again after a failed load (M11 review)", async () => {
  const { registerWorld } = await import("../src/echarts.ts");
  registerMap.mockImplementationOnce(() => {
    throw new Error("offline");
  });
  await expect(registerWorld()).rejects.toThrow("offline");
  await registerWorld();
  expect(registerMap).toHaveBeenCalledTimes(2);
  expect(registerMap).toHaveBeenLastCalledWith(
    "world",
    expect.objectContaining({ features: expect.any(Array) }),
  );
  // Once loaded, it stays loaded.
  await registerWorld();
  expect(registerMap).toHaveBeenCalledTimes(2);
});
