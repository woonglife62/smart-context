import { authMiddleware } from "./auth/middleware";
import { createUser } from "./users/createUser";

export function configureServer(app) {
  app.use(authMiddleware);
  app.post("/users", createUser);
}
