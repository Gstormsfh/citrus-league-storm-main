"""Archive verification uses tiny byte fixtures, never deserializes a model."""
import importlib.util
import io
from pathlib import Path
import tarfile

import pytest

spec = importlib.util.spec_from_file_location('development_archive',Path(__file__).resolve().parents[2]/'scripts/proof/archive_development_checkpoint.py')
module = importlib.util.module_from_spec(spec);spec.loader.exec_module(module)


def fixture(tmp_path):
    (tmp_path/'model.pickle').write_bytes(b'opaque model bytes')
    return module.snapshot(tmp_path,['model.pickle'])


def pack(path, entries):
    with tarfile.open(path,'w:gz') as archive:
        for name,body,kind in entries:
            info=tarfile.TarInfo(name);info.size=len(body);info.type=kind
            archive.addfile(info,io.BytesIO(body))


def test_complete_archive_matches_opaque_bytes_without_extraction(tmp_path):
    expected=fixture(tmp_path);path=tmp_path/'archive.tar.gz'
    pack(path,[('model.pickle',b'opaque model bytes',tarfile.REGTYPE)])
    result=module.verify_archive(tmp_path,path,expected)
    assert result['regular_files']==1 and result['complete_membership_verified']
    assert result['extracted_to_filesystem'] is False
    assert (tmp_path/'model.pickle').read_bytes()==b'opaque model bytes'


@pytest.mark.parametrize('bad',['missing','extra','duplicate','changed','symlink','traversal','source_drift'])
def test_incomplete_or_unsafe_archive_rejected(tmp_path,bad):
    expected=fixture(tmp_path);path=tmp_path/'archive.tar.gz'
    entries=[('model.pickle',b'opaque model bytes',tarfile.REGTYPE)]
    if bad=='missing':entries=[]
    elif bad=='extra':entries.append(('extra',b'no',tarfile.REGTYPE))
    elif bad=='duplicate':entries*=2
    elif bad=='changed':entries=[('model.pickle',b'changed bytes',tarfile.REGTYPE)]
    elif bad=='symlink':entries=[('model.pickle',b'',tarfile.SYMTYPE)]
    elif bad=='traversal':entries=[('../model.pickle',b'opaque model bytes',tarfile.REGTYPE)]
    else:(tmp_path/'model.pickle').write_bytes(b'changed')
    pack(path,entries)
    with pytest.raises(ValueError):module.verify_archive(tmp_path,path,expected)


def test_source_symlink_and_duplicate_rejected(tmp_path):
    fixture(tmp_path);(tmp_path/'link').symlink_to(tmp_path/'model.pickle')
    with pytest.raises(ValueError):module.snapshot(tmp_path,['link'])
    with pytest.raises(ValueError):module.snapshot(tmp_path,['model.pickle','model.pickle'])
