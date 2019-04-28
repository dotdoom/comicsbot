#!/usr/bin/env python

# An external output filter for Apache2 mod_ext_filter.
# For use in Comicslate DokuWiki to append OpenGraph tags and
# point to oEmbed server. Primarily to make URLs posted to Discord
# look pretty.

# Apache config <VirtualHost>:
#   ExtFilterDefine og_and_oembed intype=text/html \
#       cmd=/var/www/.htsecure/comicsbot/apache-filter.py
# <Directory>:
#   SetOutputFilter og_and_oembed

import cgi
import fileinput
import os
import re
import sys
import traceback
import urllib

def print_ogp_and_oembed():
  if (os.environ['REQUEST_METHOD'] != 'GET' or
      os.environ['REDIRECT_STATUS'] != '200'):
    return

  # Hardcode https because HTTP is disabled for API server.
  url_format = (
    'https://app.%(SERVER_NAME)s/embed/{}?%(QUERY_STRING)s' % os.environ)
  sys.stdout.write((
      '<meta property="og:image" content="%(image_url)s" />\n'
      '<link rel="alternate" type="application/json+oembed" '
        'href="%(oembed_url)s" />\n'
      '<meta name="twitter:card" content="summary_large_image">\n'
    ) % {
      'image_url': cgi.escape(url_format.format('image')),
      'oembed_url': cgi.escape(url_format.format('json')),
    })

title = None
description = None

# Skip any further processing and simply print the rest of the lines to stdout.
skip_processing = False

for line in fileinput.input():
  try:
    if not skip_processing:
      if line.startswith('</head>'):
        # End of <head>, print our meta-tags and passthrough the rest of file.
        print_ogp_and_oembed()
        skip_processing = True

  except:
    # If we got an error, stop any further processing and print lines as is.
    sys.stderr.write(traceback.format_exc())
    skip_processing = True

  finally:
    sys.stdout.write(line)
