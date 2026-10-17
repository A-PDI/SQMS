import "reflect-metadata";
import { Reflector } from "@nestjs/core";
import type { ExecutionContext } from "@nestjs/common";
import { PermissionsGuard } from "./guards";
import {
  PERMISSIONS_KEY,
  PUBLIC_KEY,
  SERVICE_AUTHORIZED_KEY,
} from "./decorators";
function context(handler: () => void, actor?: object): ExecutionContext {
  return {
    getHandler: () => handler,
    getClass: () => class Controller {},
    switchToHttp: () => ({ getRequest: () => ({ actor }) }),
  } as unknown as ExecutionContext;
}
describe("Default-deny endpoint authorization", () => {
  const guard = new PermissionsGuard(new Reflector());
  it("rejects a newly added authenticated endpoint without a declared policy", () => {
    expect(() =>
      guard.canActivate(context(() => {}, { permissions: new Set() })),
    ).toThrow("no declared authorization");
  });
  it("allows only explicitly public or service-authorized exceptions", () => {
    const publicHandler = () => {};
    Reflect.defineMetadata(PUBLIC_KEY, true, publicHandler);
    expect(guard.canActivate(context(publicHandler))).toBe(true);
    const serviceHandler = () => {};
    Reflect.defineMetadata(SERVICE_AUTHORIZED_KEY, true, serviceHandler);
    expect(() => guard.canActivate(context(serviceHandler))).toThrow(
      "Authentication required",
    );
    expect(
      guard.canActivate(context(serviceHandler, { permissions: new Set() })),
    ).toBe(true);
  });
  it("requires the declared backend permission independently of navigation", () => {
    const handler = () => {};
    Reflect.defineMetadata(PERMISSIONS_KEY, ["inspection:reopen"], handler);
    expect(() =>
      guard.canActivate(
        context(handler, { permissions: new Set(["inspection:write"]) }),
      ),
    ).toThrow("Missing permission");
    expect(
      guard.canActivate(
        context(handler, { permissions: new Set(["inspection:reopen"]) }),
      ),
    ).toBe(true);
  });
});
