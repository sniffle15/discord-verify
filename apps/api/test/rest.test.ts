import { describe, expect, it } from 'vitest';
import { routeKey } from '../src/discord/rest.js';

describe('routeKey', () => {
  it('keeps major parameters and collapses minor ids', () => {
    expect(routeKey('PUT', '/guilds/123456789012345678/members/234567890123456789/roles/345678901234567890')).toBe(
      'PUT /guilds/123456789012345678/members/:id/roles/:id',
    );
  });

  it('separates routes by guild', () => {
    expect(routeKey('PUT', '/guilds/111111111111111111/members/234567890123456789')).not.toBe(
      routeKey('PUT', '/guilds/222222222222222222/members/234567890123456789'),
    );
  });

  it('ignores the query string', () => {
    expect(routeKey('GET', '/users/@me?with_counts=true')).toBe('GET /users/@me');
  });
});
