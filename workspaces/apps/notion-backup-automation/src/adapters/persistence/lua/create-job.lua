-- Creates a job unless its ID exists or another job is active.
-- KEYS[1] job:<id>  KEYS[2] jobs  KEYS[3] active
-- ARGV[1] job ID  ARGV[2] job JSON  ARGV[3] createdAt in ms (the jobs score)
-- Returns {'exists', v, data} | {'active_exists', activeJobId} | {'created', '1'}

local version = redis.call('HGET', KEYS[1], 'v')

if version then
  return { 'exists', version, redis.call('HGET', KEYS[1], 'data') }
end

local active = redis.call('GET', KEYS[3])

if active then
  return { 'active_exists', active }
end

redis.call('HSET', KEYS[1], 'v', '1', 'data', ARGV[2])
redis.call('ZADD', KEYS[2], ARGV[3], ARGV[1])
redis.call('SET', KEYS[3], ARGV[1])

return { 'created', '1' }
