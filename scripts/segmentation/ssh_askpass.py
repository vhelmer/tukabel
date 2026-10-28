#!/usr/bin/env python3
"""OpenSSH password callback; the credential never enters argv or the protocol."""
import os
print(os.environ.get("TUKABEL_SSH_PASSWORD", ""))
