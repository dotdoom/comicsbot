#!/usr/bin/env python2.7
# coding: utf-8

import sys
sys.dont_write_bytecode = True

from dokuwiki import DokuWiki
from optparse import OptionParser

parser = OptionParser()
parser.add_option("-u", "--username")
parser.add_option("-p", "--password")
parser.add_option("-a", "--user_agent")
parser.add_option("-d", "--url")

(options, args) = parser.parse_args()

dw_kwargs = {}
if options.user_agent:
    dw_kwargs['user_agent'] = options.user_agent
if options.url:
    dw_kwargs['url'] = options.url

server = DokuWiki(**dw_kwargs)
if server.dokuwiki.login(options.username, options.password):
    print "; ".join("%s=%s" % (name, value)
            for name, value in server.getCookies().iteritems())
else:
    sys.exit(1)
