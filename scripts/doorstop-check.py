# ═══ Doorstop, with a new item left unreviewed until a person reads it ═══
#
# CI's traceability job runs this script with `-C -e -F` (reqs/README.md). Doorstop 3.2 reviews a
# new item by itself during validation. The setting is `settings.REVIEW_NEW_ITEMS`, True by
# default (doorstop/settings.py:43), and doorstop/core/validators/item_validator.py:103-104 calls
# `item.review()` when it is True. The item gets a `reviewed:` stamp, so the check passes on a rule
# that nobody read. Doorstop 3.2 has no command-line flag for the setting.
#
# This script sets the setting to False and runs the Doorstop command line with its arguments.
# With the setting False, Doorstop reports a new item only as the info "needs initial review", and
# `-e` does not make info an error. The script makes that one message an error that names the item.
# No other check changes. `-w` would make every info-level issue an error too, and some of those
# are in the tree today.
#
# Usage: python scripts/doorstop-check.py -C -e -F
#
# This script stamps nothing. A person reads a flagged item, then runs `doorstop review <ID>`
# (reqs/README.md). The script matches the message text of Doorstop 3.2, so it checks the installed
# version before anything else runs. On any other version, it prints one line to stderr that names
# the pin and exits 1. `doorstop.__version__` is "(local)" for a Doorstop run from a source tree,
# which also fails the check.

import sys

import doorstop

PINNED = "3.2"
VERSION = getattr(doorstop, "__version__", "unknown")
if VERSION != PINNED:
    sys.exit(
        f"doorstop-check.py needs doorstop=={PINNED} (reqs/README.md), "
        f"found Doorstop {VERSION}. This wrapper matches the message text of "
        f"Doorstop {PINNED}. Run `pip install doorstop=={PINNED}`."
    )

# The imports below depend on Doorstop 3.2's internals, so they come after the version check.
from doorstop import settings
from doorstop.cli.main import main
from doorstop.common import DoorstopError, DoorstopInfo
from doorstop.core.validators import item_validator

NEEDS_REVIEW = "needs initial review"

settings.REVIEW_NEW_ITEMS = False

_stock_get_issues = item_validator.ItemValidator.get_issues


def _get_issues(self, item, *args, **kwargs):
    for issue in _stock_get_issues(self, item, *args, **kwargs):
        if isinstance(issue, DoorstopInfo) and str(issue) == NEEDS_REVIEW:
            # Doorstop prefixes the item's UID to each issue of an item, so the text omits it.
            issue = DoorstopError(
                f"{NEEDS_REVIEW}; read it, then run `doorstop review {item.uid}`"
            )
        yield issue


item_validator.ItemValidator.get_issues = _get_issues

if __name__ == "__main__":
    sys.exit(main())
