<?php
declare(strict_types=1);

require_once dirname(__DIR__, 2) . '/server/core/portable-project-import.php';

function testAssert(bool $condition, string $message): void
{
    if (!$condition) {
        throw new RuntimeException($message);
    }
}

function createTestZip(string $path, array $entries): void
{
    $zip = new ZipArchive();
    testAssert($zip->open($path, ZipArchive::CREATE | ZipArchive::OVERWRITE) === true, 'Could not create test ZIP.');
    foreach ($entries as $name => $contents) {
        testAssert($zip->addFromString($name, $contents), 'Could not add test ZIP entry: ' . $name);
    }
    testAssert($zip->close(), 'Could not close test ZIP.');
}

function expectImportFailure(string $zipPath, string $filename, string $libraryRoot, string $messagePart): void
{
    try {
        importPortableProjectZip($zipPath, $filename, $libraryRoot);
    } catch (PortableProjectImportException $error) {
        testAssert(
            str_contains(strtolower($error->getMessage()), strtolower($messagePart)),
            'Unexpected import error: ' . $error->getMessage()
        );
        return;
    }
    throw new RuntimeException('Expected import failure: ' . $messagePart);
}

function removeTestTree(string $root): void
{
    if (!is_dir($root)) return;
    $iterator = new RecursiveIteratorIterator(
        new RecursiveDirectoryIterator($root, FilesystemIterator::SKIP_DOTS),
        RecursiveIteratorIterator::CHILD_FIRST
    );
    foreach ($iterator as $item) {
        if ($item->isDir() && !$item->isLink()) rmdir($item->getPathname());
        else unlink($item->getPathname());
    }
    rmdir($root);
}

$temporaryRoot = sys_get_temp_dir() . DIRECTORY_SEPARATOR . 'movement-import-test-' . bin2hex(random_bytes(8));
$libraryRoot = $temporaryRoot . DIRECTORY_SEPARATOR . 'library';
mkdir($temporaryRoot, 0700, true);

try {
    $validZip = $temporaryRoot . DIRECTORY_SEPARATOR . 'story.zip';
    $flow = [
        'title' => 'Imported </script> Story',
        'description' => 'A portable test.',
        'isPublished' => true,
        'publishedAt' => '2026-08-04T00:00:00Z',
        'schemaVersion' => 1,
        'defaultBeatSeconds' => 5,
        'openingImage' => 'cover.png',
        'slides' => [['text' => 'Hello']],
    ];
    createTestZip($validZip, [
        'story/player.html' => '<!doctype html><title>Portable</title>',
        'story/flow.json' => json_encode($flow, JSON_THROW_ON_ERROR),
        'story/img/cover.png' => "\x89PNG\r\n\x1A\n",
    ]);

    $first = importPortableProjectZip($validZip, 'story.zip', $libraryRoot);
    testAssert($first['project'] === 'story', 'The first project slug was not preserved.');
    testAssert($first['mediaCount'] === 1, 'The imported media count is wrong.');
    $firstRoot = $libraryRoot . DIRECTORY_SEPARATOR . 'story';
    $firstRaw = file_get_contents($firstRoot . DIRECTORY_SEPARATOR . 'flow.json');
    $firstFlow = json_decode((string) $firstRaw, true, 512, JSON_THROW_ON_ERROR);
    testAssert($firstFlow['isPublished'] === false, 'Imported projects must return to Draft.');
    testAssert(!isset($firstFlow['publishedAt']), 'Imported publication timestamps must be removed.');
    testAssert($firstFlow['schemaVersion'] === 2, 'Imported flow schema was not normalized.');
    testAssert($firstFlow['openingImage'] === 'cover.png', 'A valid opening image was not retained.');
    testAssert(!str_contains((string) $firstRaw, '</script>'), 'Imported flow JSON is unsafe for editor embedding.');
    testAssert(is_file($firstRoot . DIRECTORY_SEPARATOR . 'img' . DIRECTORY_SEPARATOR . 'cover.png'), 'Media was not imported.');
    testAssert(!is_file($firstRoot . DIRECTORY_SEPARATOR . 'player.html'), 'Portable player.html should not enter online storage.');
    testAssert(is_file($firstRoot . DIRECTORY_SEPARATOR . '.htaccess'), 'Imported storage protection is missing.');

    $second = importPortableProjectZip($validZip, 'story.zip', $libraryRoot);
    testAssert($second['project'] === 'story-2', 'Name conflicts must create a safe copy slug.');

    $traversalZip = $temporaryRoot . DIRECTORY_SEPARATOR . 'traversal.zip';
    createTestZip($traversalZip, [
        'story/flow.json' => json_encode(['title' => 'Unsafe', 'slides' => []], JSON_THROW_ON_ERROR),
        'story/../evil.php' => '<?php echo "unsafe";',
    ]);
    expectImportFailure($traversalZip, 'traversal.zip', $libraryRoot, 'unsafe file path');

    $fakeMediaZip = $temporaryRoot . DIRECTORY_SEPARATOR . 'fake-media.zip';
    createTestZip($fakeMediaZip, [
        'fake/flow.json' => json_encode(['title' => 'Fake media', 'slides' => []], JSON_THROW_ON_ERROR),
        'fake/img/not-an-image.png' => '<?php echo "not an image";',
    ]);
    expectImportFailure($fakeMediaZip, 'fake-media.zip', $libraryRoot, 'do not match');
    testAssert(!is_dir($libraryRoot . DIRECTORY_SEPARATOR . 'fake'), 'A failed import left a project behind.');

    echo "PORTABLE_IMPORT_TEST_OK\n";
} finally {
    removeTestTree($temporaryRoot);
}
