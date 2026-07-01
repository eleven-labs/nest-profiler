/** Claims decoded from the demo JWT and attached to the request by {@link JwtAuthGuard}. */
export interface AuthenticatedUser {
  sub: string;
  username: string;
  email: string;
  roles: string[];
  iat: number;
  exp: number;
}
