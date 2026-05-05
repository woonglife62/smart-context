export function authMiddleware(req, res, next) {
  if (!req.headers.authorization) {
    res.status(401).send({ error: "missing authorization" });
    return;
  }
  next();
}
