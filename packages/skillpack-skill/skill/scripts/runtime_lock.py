"""Cross-platform advisory lock for Skillpack runtime installation state."""
import os
import stat
from contextlib import contextmanager
from pathlib import Path


@contextmanager
def runtime_lock(directory: Path, name: str = '.install.lock'):
    directory.mkdir(parents=True, exist_ok=True, mode=0o700)
    lock_path = directory / name
    if os.path.lexists(lock_path) and stat.S_ISLNK(os.lstat(lock_path).st_mode):
        raise ValueError(f'refusing symlinked runtime lock: {lock_path}')
    flags = os.O_RDWR | os.O_CREAT | getattr(os, 'O_NOFOLLOW', 0) | getattr(os, 'O_BINARY', 0)
    descriptor = os.open(lock_path, flags, 0o600)
    locked = False
    try:
        os.write(descriptor, b'0')
        os.lseek(descriptor, 0, os.SEEK_SET)
        if os.name == 'nt':
            import msvcrt
            msvcrt.locking(descriptor, msvcrt.LK_LOCK, 1)
        else:
            import fcntl
            fcntl.flock(descriptor, fcntl.LOCK_EX)
        locked = True
        yield
    finally:
        if locked:
            if os.name == 'nt':
                import msvcrt
                os.lseek(descriptor, 0, os.SEEK_SET)
                msvcrt.locking(descriptor, msvcrt.LK_UNLCK, 1)
            else:
                import fcntl
                fcntl.flock(descriptor, fcntl.LOCK_UN)
        os.close(descriptor)
