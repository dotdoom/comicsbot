# coding: utf-8

import sys
import base64
import xmlrpclib

class CookieTransport(xmlrpclib.Transport):
    cookies = {}

    def send_cookies(self, connection):
        cookies = "; ".join("%s=%s" % (cookie_name, cookie_value)
                            for cookie_name, cookie_value
                            in self.cookies.iteritems())
        if cookies:
            connection.putheader("Cookie", cookies)

    def send_user_agent(self, host):
        self.send_cookies(host)
        return xmlrpclib.Transport.send_user_agent(self, host)

    def parse_response(self, response):
        for header in response.msg.getallmatchingheaders("Set-Cookie"):
            val = header.split(":", 1)[1]
            cookie_name, cookie_value = val.split(";", 1)[0].split("=", 1)
            self.cookies[cookie_name.strip()] = cookie_value
        return xmlrpclib.Transport.parse_response(self, response)


class DokuWiki(xmlrpclib.ServerProxy):
    """DokuWiki wrapper around xmlrpclib.ServerProxy.

    API Doc: https://www.dokuwiki.org/devel:xmlrpc

    Sample usage:
      server = DokuWiki()
      if server.dokuwiki.login(user, password):
        print server.wiki.getPage("index")
    """

    def __init__(self, url="http://localhost/lib/exe/xmlrpc.php",
            user_agent=None):
        self.transport = CookieTransport()
        if user_agent:
            self.transport.user_agent = user_agent
        xmlrpclib.ServerProxy.__init__(self, url, transport=self.transport)

    def getCookies(self):
        return self.transport.cookies
