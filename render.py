#!/usr/bin/env python2.7
# coding: utf-8

import collections
import errno
import logging
import os
import sys
import time
import urllib2

from dokuwiki import DokuWiki
from html2png import HTML2PNG, ApplicationWrapper

USER_AGENT = "RenderComics/1.0"
ROOT_CATEGORY = "discuss"
PAGE_URL_FORMAT = "http://localhost/%(category)s/%(comics)s/%(page)s"
EXPORT_SUFFIX = "&do=export_xhtml"
FILE_PATH_FORMAT = "data/media/%(category)s/%(comics)s/u/%(page)s.png"

ANTIALIAS_FONT_CONFIG = """
<?xml version='1.0'?>
<!DOCTYPE fontconfig SYSTEM 'fonts.dtd'>
<fontconfig>
<match target="font" >
<edit mode="assign" name="rgba" >
<const>none</const>
</edit>
</match>
<match target="font" >
<edit mode="assign" name="hinting" >
<bool>true</bool>
</edit>
</match>
<match target="font" >
<edit mode="assign" name="hintstyle" >
<const>hintslight</const>
</edit>
</match>
<match target="font" >
<edit mode="assign" name="antialias" >
<bool>true</bool>
</edit>
</match>
</fontconfig>
""".strip()

def WriteFontConfig(path="~/.config/fontconfig/fonts.conf"):
    path = os.path.expanduser(path)
    with open(path, "w") as cfg:
        cfg.write(ANTIALIAS_FONT_CONFIG)

execfile("config.py")

logging.basicConfig(level=logging.WARNING)

WriteFontConfig()

w = DokuWiki(user_agent=USER_AGENT)
if not w.dokuwiki.login(config["dokuwiki"]["username"],
        config["dokuwiki"]["password"]):
    sys.stderr.write("Cannot authenticate to DokuWiki.\n")
    sys.exit(1)

class Stats(object):
    def __init__(self, output):
        self.stats = {}
        self.items = {}
        self.last_print = None
        self.output = output
        self.latest_update = ""

    def Add(self, page, key=None, value=None):
        full_name = "%s:%s" % (page["category"], page["comics"])
        self.latest_update = full_name

        new = False
        if full_name not in self.stats:
            self.stats[full_name] = collections.defaultdict(int)
            self.items[full_name] = collections.defaultdict(list)
            new = True
        if not key:
            key = "count"
        if value:
            self.stats[full_name][key] = value
        else:
            self.stats[full_name][key] += 1
        if len(self.items[full_name][key]) < 5:
            self.items[full_name][key].append(page["page"])

        now = time.time()
        if self.last_print:
            if self.last_print + 30 < now:
                self.Print()
                self.last_print = now
        else:
            self.last_print = now

        return new

    def Print(self, suffix="", output=None):
        if output is None:
            output = self.output
        with open(output, "w") as output:
            output.write("Statistics at %s%s (latest update to %s):\n" % (
                time.ctime(time.time()), suffix, self.latest_update))
            for full_name, data in self.stats.iteritems():
                output.write("  %s\n" % full_name)
                for k, v in data.iteritems():
                    items = self.items[full_name][k]
                    text = "    %s: %s" % (k, v)
                    if items:
                        text += " (" + ", ".join(items) + "...)"
                    output.write(text + "\n")

stats = Stats(output=os.path.join(config["dokuwiki"]["root"],
    "render-stats.txt"))

def comicStripSelector(page):
    def selector(document):
        container_name = "div.ct-container"
        container = document.findFirst(container_name)
        # container may be present on the page, but it's geompetry is empty:
        # e.g. pages with "source" image and translations along with already
        # renderred image
        if container.geometry().size().isEmpty():
            container_name = "div.fn-container"
            container = document.findFirst(container_name)
        if container.geometry().size().isEmpty():
            if not document.findFirst("iframe").isNull():
                raise RuntimeError("Iframe is present on page (YT/external)")
            size = None
            for container in document.findAll("img"):
                if "plugins/cnav" not in container.attribute("src"):
                    size = container.geometry().size()
                    if size.width() > 50 and size.height() > 50:
                        # Multiple images on the page,
                        # e.g. w/ and w/o translation, or navigation icons.
                        break
                    else:
                        size = None
            if not size:
                raise RuntimeError("Image not found on page")
            container_name = "img:not([src*='plugins/cnav'])"
        else:
            image = container.findFirst("img")
            size = image.geometry().size()
            size.setHeight(size.height() + 10)
            size.setWidth(size.width() + 10)
        if size.width() < 40 or size.height() < 40:
            raise RuntimeError("Selected element is too small")
        stats.Add(page, "selector/" + container_name)
        return (container, size)
    return selector

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

def main():
    renderer = HTML2PNG(
        cookies=["%s=%s" % (k, v) for k, v in w.getCookies().iteritems()],
        user_agent=USER_AGENT,
        logger=logging)

    def renderPage(page):
        output_file = os.path.join(config["dokuwiki"]["root"],
                FILE_PATH_FORMAT % page)
        if os.path.exists(output_file):
            if page["mtime"] < os.path.getmtime(output_file):
                stats.Add(page, "skipped (already rendered)")
                return
            else:
                stats.Add(page, "re-rendered (outdated)")
        selector = comicStripSelector(page)
        full_page_url = PAGE_URL_FORMAT % page
        try:
            renderer.Render(full_page_url + EXPORT_SUFFIX, output_file,
                    element_selector=selector)
        except Exception as e:
            # In case of redirects, export_xhtml doesn't return 301/302,
            # so we have to request the "full" page to get the new location.
            redirected_url = urllib2.urlopen(full_page_url, "HEAD").geturl()
            if redirected_url == full_page_url:
                raise
            else:
                stats.Add(page, "redirected")
                renderer.Render(redirected_url + EXPORT_SUFFIX, output_file,
                        element_selector=selector)
        stats.Add(page, "rendered")

    def prepareDirectories(data):
        pages = []
        for entry in data:
            category_comics_page = entry["id"].split(":")
            if len(category_comics_page) == 3:
                page = {
                    "category": category_comics_page[0],
                    "comics": category_comics_page[1],
                    "page": category_comics_page[2],
                    "mtime": entry["mtime"],
                }
                if stats.Add(page):
                    directory = os.path.dirname(
                            os.path.join(config["dokuwiki"]["root"],
                                FILE_PATH_FORMAT % page))
                    mkdir_p(directory)
                    # To avoid backups of rendered strips
                    touch(os.path.join(directory, "purgefile"))
                if page["page"][0].isdigit():
                    pages.append(page)
                else:
                    stats.Add(page, "skipped (non-strip)")
        return pages

    for category in w.dokuwiki.getPagelist(ROOT_CATEGORY, {"depth": 2}):
        category = category["id"].split(":")[1]
        for page in prepareDirectories(
                w.dokuwiki.getPagelist(category, {"depth": 3})):
            try:
                renderPage(page)
            except Exception as e:
                stats.Add(page, "failed/" + e.message.lower())
    stats.Print(suffix=" (finished)")

sys.exit(ApplicationWrapper(main))
