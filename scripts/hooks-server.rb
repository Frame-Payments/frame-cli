#!/usr/bin/env ruby
# frozen_string_literal: true
#
# Tiny local webhook receiver for `frame listen --forward-to`.
# Prints X-Frame-* headers and pretty-prints the JSON body.
# Returns 200 OK so the listen terminal shows a clean delivery.
#
# Usage:
#   ruby scripts/hooks-server.rb            # listens on :4000, route /hooks
#   PORT=5000 ROUTE=/x ruby scripts/hooks-server.rb

require "webrick"
require "json"

port  = (ENV["PORT"] || 4000).to_i
route = ENV["ROUTE"] || "/hooks"

server = WEBrick::HTTPServer.new(
  Port: port,
  AccessLog: [],
  Logger: WEBrick::Log.new(nil, WEBrick::Log::WARN),
)

server.mount_proc(route) do |req, res|
  puts "── #{Time.now.strftime("%H:%M:%S")}  #{req.request_method} #{req.path}"
  req.header.each_pair do |k, v|
    puts "  #{k}: #{v.first}" if k.start_with?("x-frame")
  end
  begin
    puts JSON.pretty_generate(JSON.parse(req.body))
  rescue JSON::ParserError
    puts req.body
  end
  puts
  res.status = 200
  res["Content-Type"] = "text/plain"
  res.body = "ok"
end

trap("INT") { server.shutdown }
puts "Listening on http://localhost:#{port}#{route}  (Ctrl-C to stop)"
server.start
