"""Local SMTP fixture; captures only mail sent by isolated tests."""
import base64
import email
import email.policy
import queue
import socketserver


class Inbox(socketserver.ThreadingTCPServer):
    allow_reuse_address = True
    daemon_threads = True

    def __init__(self):
        self.messages = queue.Queue()
        self.reject = False
        self.expected_credentials = None
        self.authenticated = queue.Queue()
        super().__init__(('127.0.0.1', 0), SmtpHandler)


class SmtpHandler(socketserver.StreamRequestHandler):
    def handle(self):
        self.wfile.write(b'220 local test inbox\r\n')
        while line := self.rfile.readline():
            verb = line.split(b' ', 1)[0].strip().upper()
            if verb == b'DATA':
                if self.server.reject:
                    self.wfile.write(b'451 temporary delivery failure\r\n')
                    continue
                self.wfile.write(b'354 send message\r\n')
                parts = []
                while (part := self.rfile.readline()) not in (b'.\r\n', b''):
                    parts.append(part)
                self.server.messages.put(email.message_from_bytes(b''.join(parts), policy=email.policy.default))
                self.wfile.write(b'250 accepted\r\n')
            elif verb == b'QUIT':
                self.wfile.write(b'221 goodbye\r\n')
                return
            elif verb == b'EHLO':
                self.wfile.write(b'250-test inbox\r\n250 AUTH LOGIN\r\n')
            elif verb == b'AUTH':
                self.wfile.write(b'334 VXNlcm5hbWU6\r\n')
                username = base64.b64decode(self.rfile.readline().strip()).decode()
                self.wfile.write(b'334 UGFzc3dvcmQ6\r\n')
                password = base64.b64decode(self.rfile.readline().strip()).decode()
                credentials = (username, password)
                self.server.authenticated.put(credentials)
                if credentials == self.server.expected_credentials:
                    self.wfile.write(b'235 Authentication succeeded\r\n')
                else:
                    self.wfile.write(b'535 Authentication failed\r\n')
            else:
                self.wfile.write(b'250 OK\r\n')


