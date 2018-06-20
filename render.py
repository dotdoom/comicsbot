#!/usr/bin/env python2.7

# TODO(dotdoom): add Chrome version to stats output (fetch it in web2png
#                via Qt.CHROMIUM_VERSION and pass it through to here).

import codecs
import collections
import errno
import logging
import os
import re
import subprocess
import sys
import time
import urllib

from dokuwiki import DokuWiki
from web2png import RenderEngine

USER_AGENT = "RenderComics/1.0"
ROOT_CATEGORY = "menu"
PAGE_URL_FORMAT = "http://localhost/%(comics)s/%(page)s"
EXPORT_SUFFIX = "&do=export_xhtml"

execfile("config.py")

logging.basicConfig(level=logging.WARNING)

w = DokuWiki(user_agent=USER_AGENT)
if not w.dokuwiki.login(config["dokuwiki"]["username"],
        config["dokuwiki"]["password"]):
    sys.stderr.write("Cannot authenticate to DokuWiki.\n")
    sys.exit(1)

def pageFilePath(page):
    page = page.copy()
    for k in list(page.keys()):
        page[k] = urllib.quote(unicode(page[k]).encode("utf-8"))
    return os.path.join(config["dokuwiki"]["root"],
            "data/media/%(comics)s/u/%(page)s.png" % page)

class Stats(object):

    MAX_SAMPLES = 5
    REFRESH_SECONDS = 15

    def __init__(self, output):
        self.stats = collections.OrderedDict()
        self.items = {}
        self.last_print = None
        self.output = output
        self.latest_update = ""
        self.total_count = 0
        self.total_others = 0

    def Add(self, page, key="count"):
        key = unicode(key)
        full_name = page["comics"]
        self.latest_update = full_name

        if key == "count":
            self.total_count += 1
        else:
            self.total_others += 1

        if full_name not in self.stats:
            self.stats[full_name] = collections.defaultdict(int)
            self.items[full_name] = collections.defaultdict(list)
        self.stats[full_name][key] += 1
        if len(self.items[full_name][key]) <= self.MAX_SAMPLES:
            self.items[full_name][key].append(page["page"])

        now = time.time()
        if self.last_print:
            if self.last_print + self.REFRESH_SECONDS < now:
                self.Print()
                self.last_print = now
        else:
            self.last_print = now

    def Print(self, suffix=""):
        with open(self.output, "w") as output:
            output.write(str(codecs.BOM_UTF8))
            output.write(
                    "Statistics at %s%s (%d/%d, latest update to %s):\n" % (
                        time.ctime(time.time()), suffix, self.total_others,
                        self.total_count, self.latest_update))
            for full_name, data in self.stats.iteritems():
                output.write("  %s\n" % full_name.encode("utf-8"))
                for k, v in data.iteritems():
                    items = self.items[full_name][k]
                    text = "    %s: %s" % (k, v)
                    if items:
                        text += (
                            " (" + ", ".join(items[:self.MAX_SAMPLES]) +
                            ("..." if len(items) > self.MAX_SAMPLES else "") +
                            ")"
                        )
                    output.write(text + "\n")

stats = Stats(output=os.path.join(config["dokuwiki"]["root"],
    "render-stats.txt"))


def mkdir_p(path):
    try:
        os.makedirs(path)
    except OSError as e:
        if e.errno == errno.EEXIST:
            pass
        else:
            raise

def touch(fname, times=None):
    with open(fname, "a"):
        os.utime(fname, times)

def newer_than(fname, mtime):
    try:
        return mtime < os.path.getmtime(fname)
    except OSError as e:
        if e.errno == errno.ENOENT:
            return False
        raise

cookies = [(k, v) for k, v in w.getCookies().iteritems()]

def prepareDirectories(data):
    pages = []
    for entry in data:
        comics_page = unicode(entry["id"]).split(":")
        pagenum = comics_page.pop()
        comics = '/'.join(comics_page)
        page = {
            "comics": comics,
            "page": pagenum,
            "mtime": entry["mtime"],
        }
        output_file = pageFilePath(page)
        stats.Add(page)
        directory = os.path.dirname(output_file)
        mkdir_p(directory)
        # To prevent backing up the images we generate.
        touch(os.path.join(directory, "purgefile"))

        if page["page"][0].isdigit():
            if newer_than(output_file, page["mtime"]):
                stats.Add(page, "skipped: already rendered and up-to-date")
            else:
                pages.append(page)
        else:
            stats.Add(page, "skipped: non-strip")
    return pages

urls = []
all_pages = w.dokuwiki.getPagelist("", {"depth": 5})
for comics in re.findall(r'\[\[:([^\]]+):index\]\]', w.wiki.getPage(ROOT_CATEGORY)):
    comics = unicode(comics)
    for page in prepareDirectories(filter(lambda p: unicode(p["id"]).startswith(comics + ':'), all_pages)):
        # TODO(dotdoom): handle redirects somehow (export_xhtml doesn't do them)
        urls.append(((PAGE_URL_FORMAT % page) + EXPORT_SUFFIX, page),)

ppjs = """
document.body.style.overflow = "hidden";
var container =
  document.querySelector("div.ct-container") ||
  document.querySelector("div.fn-container");
if (container) {
  var rect = container.getBoundingClientRect();
  [
   rect.left, rect.top,
   rect.right-rect.left,
   rect.bottom-rect.top
  ];
} else {
  var navControls = document.getElementsByClassName("cnav");
  for (var i = 0; i < navControls.length; i++) {
    navControls[i].style.display = "none";
  }
  var pageNames = document.getElementsByTagName("h5");
  if (pageNames.length > 0) {
    pageNames[0].style.display = "none";
  }
  null; // Take screenshot of the whole page
}
"""

def afterRender(page, data):
    if isinstance(data, Exception):
        stats.Add(page, "failed: " + data.message)
        return
    output_file = pageFilePath(page)
    temp_file = output_file + ".tmp"
    try:
        with open(temp_file, "w") as output:
            output.write(data)
        subprocess.call([
            "mogrify",
            "-fuzz", "1%",
            "-trim",
            temp_file,
        ])
        subprocess.call([
            "optipng",
            "-fix",       # error recovery
            "-preserve",  # preserve file attributes if possible
            "-force",     # force overwriting original file
            "-quiet",     # do not talk too much
            temp_file,
        ])
        os.rename(temp_file, output_file)
    finally:
        if os.path.exists(temp_file):
            os.remove(temp_file)

    stats.Add(page, "rendered")

stats.Print(suffix=" (started)")
code = RenderEngine(
    urls=urls,
    postprocess_javascript=ppjs,
    after_render=afterRender,
    cookies=cookies,
    headers=(
        ("User-Agent", USER_AGENT),
        ("Upgrade-Insecure-Requests", "0"),
    )
).Run()
stats.Print(suffix=" (finished)")
sys.exit(code)
