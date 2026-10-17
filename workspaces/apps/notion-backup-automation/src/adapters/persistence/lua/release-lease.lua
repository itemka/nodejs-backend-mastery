-- Compare-and-delete: releases the lease only if this worker still holds it.
-- KEYS[1] lease:<id>  ARGV[1] worker ID
-- Returns 1 if released, 0 otherwise

if redis.call('GET', KEYS[1]) == ARGV[1] then
  return redis.call('DEL', KEYS[1])
end

return 0
