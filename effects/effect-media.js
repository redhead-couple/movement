// Shared media acquisition for effect engines.
// Player playback supplies decoded image nodes through config.preloadedImages;
// maker previews and standalone engine mounts fall back to a normal Image.

export function createEffectImage(config, source) {
    const normalizedSource = typeof source === 'string' ? source.trim() : '';
    const preloadedImages = config && config.preloadedImages;
    const preloadedImage = normalizedSource
        && preloadedImages
        && typeof preloadedImages.get === 'function'
        ? preloadedImages.get(normalizedSource)
        : null;

    if (preloadedImage && (preloadedImage.naturalWidth || preloadedImage.width)) {
        return { image: preloadedImage, isPreloaded: true };
    }

    return {
        image: typeof Image === 'function' ? new Image() : null,
        isPreloaded: false
    };
}
