#!/usr/bin/env python2.7
# coding: utf-8

import inspect
import logging
logging.basicConfig(level=logging.DEBUG)
import os
import sys
import time
import uuid

from comicsbot import ComicsBot
from dokuwiki import DokuWiki
from roomlogger import RoomLogger

execfile(sys.argv[1] if len(sys.argv) > 1 else "config.py")

w = DokuWiki()
if w.dokuwiki.login(config["dokuwiki"]["username"],
        config["dokuwiki"]["password"]):
    welcome_message = "Hello! I've connected to wiki %s version %s, " \
        "xmlrpc %s" % (w.dokuwiki.getTitle(), w.dokuwiki.getVersion(),
                w.dokuwiki.getXMLRPCAPIVersion())
else:
    welcome_message = "Hi! I cannot authorize to the wiki."
    w = None

room_logger = RoomLogger(config["jabber"]["logdir"])

bot = ComicsBot(
        config["jabber"]["username"],
        config["jabber"]["password"],
        wiki=w,
        room_logger=room_logger,
        res=config["jabber"].get("resource", str(uuid.uuid4())),
        debug=True,  # log XMPP messages
        markov_file=os.path.join(config["jabber"]["logdir"], "markov.json"))
bot.join_room(config["jabber"]["room"], config["jabber"]["nick"])
time.sleep(1)
#bot.send(config["jabber"]["room"], welcome_message, message_type="groupchat")
bot.serve_forever()
