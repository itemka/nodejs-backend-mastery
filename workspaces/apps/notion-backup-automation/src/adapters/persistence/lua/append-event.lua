-- Appends one event and keeps only the newest ones.
-- KEYS[1] events:<id>  ARGV[1] event JSON  ARGV[2] the maximum number of events
-- Returns the list length after trimming

redis.call('RPUSH', KEYS[1], ARGV[1])
redis.call('LTRIM', KEYS[1], -tonumber(ARGV[2]), -1)

return redis.call('LLEN', KEYS[1])
