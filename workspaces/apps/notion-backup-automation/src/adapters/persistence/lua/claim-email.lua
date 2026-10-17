-- Claims a Gmail message for a job, once. The key is never deleted.
-- KEYS[1] email:<messageId>  ARGV[1] job ID
-- Returns the owning job ID: ARGV[1] if it is new or already this job's, otherwise the first owner

local owner = redis.call('GET', KEYS[1])

if owner then
  return owner
end

redis.call('SET', KEYS[1], ARGV[1])

return ARGV[1]
