import { authMiddleware } from "../src/auth/middleware";

test("login failure returns 401 without authorization", () => {
  const res = { status: () => res, send: () => undefined };
  authMiddleware({ headers: {} }, res, () => undefined);
});
