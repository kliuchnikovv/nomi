#!/usr/bin/env python3
"""
Lightweight healthcheck server for Railway.
Runs on IPv4 (0.0.0.0) on port 8000 to support Railway healthcheck,
while main app runs on dual-stack (::) on port 7777.
"""
import os
from http.server import HTTPServer, BaseHTTPRequestHandler
from datetime import datetime

class HealthCheckHandler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path == '/health':
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            response = {
                "status": "ok",
                "time": datetime.utcnow().isoformat()
            }
            self.wfile.write(str(response).encode())
        else:
            self.send_response(404)
            self.end_headers()
    
    def log_message(self, format, *args):
        # Suppress logs
        pass

if __name__ == '__main__':
    port = int(os.getenv("HEALTHCHECK_PORT", 8000))
    server = HTTPServer(('0.0.0.0', port), HealthCheckHandler)
    print(f"Healthcheck server running on http://0.0.0.0:{port}")
    server.serve_forever()
