#!/usr/bin/env python2.7
# coding: utf-8

import unittest

from comicsbot import ParseTimeSpanToSeconds

class TestComicsBot(unittest.TestCase):

  def test_timespan_parser(self):
    test_cases = {
        "10m": 10 * 60,
        "2s": 2,
        "3d": 3 * 24 * 60 * 60,
        "4w": 4 * 7 * 24 * 60 * 60,
        "5": 5,
        "6.5h": 6.5 * 60 * 60,
    }
    for span_string, span_seconds in test_cases.iteritems():
        self.assertEqual(span_seconds,
                ParseTimeSpanToSeconds(span_string))
    self.assertEqual(42, ParseTimeSpanToSeconds(None, default=42))

if __name__ == '__main__':
    unittest.main()
