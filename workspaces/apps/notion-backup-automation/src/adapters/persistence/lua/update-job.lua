-- Compare-and-set: writes the job only if its stored version is the expected one.
-- KEYS[1] job:<id>  KEYS[2] active
-- ARGV[1] job ID  ARGV[2] expected version  ARGV[3] job JSON  ARGV[4] '1' if the new status is terminal
-- Returns {'not_found'} | {'conflict', v} | {'updated', v + 1}

local version = redis.call('HGET', KEYS[1], 'v')

if not version then
  return { 'not_found' }
end

if version ~= ARGV[2] then
  return { 'conflict', version }
end

local nextVersion = tostring(tonumber(version) + 1)

redis.call('HSET', KEYS[1], 'v', nextVersion, 'data', ARGV[3])

if ARGV[4] == '1' and redis.call('GET', KEYS[2]) == ARGV[1] then
  redis.call('DEL', KEYS[2])
end

return { 'updated', nextVersion }
