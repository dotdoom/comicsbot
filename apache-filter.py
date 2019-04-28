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

def print_ogp_and_oembed(original_title, original_description):
  title = original_title
  if original_title and original_description.startswith(original_title):
    title = original_description[len(original_title):]
  if title:
    title = title.strip()
    # title is already escaped, no need to do that again
    sys.stdout.write('<meta property="og:title" content="%s" />\n' % title)

  base_url = 'https://app.%s/embed/' % os.environ['HTTP_HOST']
  request_uri = urllib.quote(os.environ['REQUEST_URI'])
  image_url = base_url + 'image?uri=' + request_uri
  oembed_url = base_url + 'json?uri=' + request_uri

  sys.stdout.write((
      '<meta property="og:image" content="%(image_url)s" />\n'
      '<link rel="alternate" type="application/json+oembed" '
        'href="%(oembed_url)s" />\n'
      '<meta name="twitter:card" content="summary_large_image">\n'
    ) % {
      'image_url': cgi.escape(image_url),
      'oembed_url': cgi.escape(oembed_url),
    })

title = None
description = None

# Skip any further processing and simply print the rest of the lines to stdout.
skip_processing = True

with open('/tmp/environ', 'w') as f:
  f.write(str(os.environ))

for line in fileinput.input():
  # Print the current line to stdout. This variable is reset before each line.
  print_line_to_stdout = True

  try:
    if not skip_processing:
      if line.startswith('<meta '):
        title_match = re.match(
          '^<meta property="og:title" content="([^"]*)" />$', line)
        if title_match:
          title = title_match.group(1)
          print_line_to_stdout = False
          continue

        description_match = re.match(
          '^<meta property="og:description" content="([^"]*)" />$', line)
        if description_match:
          description = description_match.group(1)
          print_line_to_stdout = False
          continue

        if line.startswith('<meta property="og:image" content="([^"]+)" />$'):
          # Skip through images completely. We will insert our own.
          print_line_to_stdout = False
          continue

      if line.startswith('</head>'):
        # End of <head>, print our meta-tags and passthrough the rest of file.
        print_ogp_and_oembed(title, description)
        skip_processing = True

  except:
    # If we got an error, stop any further processing and print lines as is.
    sys.stderr.write(traceback.format_exc())
    print_line_to_stdout = True
    skip_processing = True

  finally:
    if print_line_to_stdout:
      sys.stdout.write(line)
