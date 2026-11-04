from pathlib import Path

from utilities.extractor import extractor


if __name__ == "__main__":
    project_folder = Path(__file__).resolve().parent.parent
    input_folder = project_folder / "2025"
    output_folder = project_folder / "2025_extracted"
    output_folder.mkdir(exist_ok=True)

    failures = []
    for pdf_path in sorted(input_folder.glob("*.pdf")):
        output_path = output_folder / f"{pdf_path.stem}.md"
        if output_path.exists():
            continue
        try:
            output_path.write_text(extractor(pdf_path.read_bytes()), encoding="utf-8")
        except Exception as error:
            failures.append(pdf_path.name)
            print(f"Failed: {pdf_path.name}: {error}", flush=True)

    print(f"Extraction complete. Failures: {len(failures)}")
    if failures:
        raise SystemExit(f"{len(failures)} PDFs failed extraction")
