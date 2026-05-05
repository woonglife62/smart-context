export async function createUser(req, res) {
  const user = { id: "user_123", email: req.body.email };
  res.status(201).send(user);
}
