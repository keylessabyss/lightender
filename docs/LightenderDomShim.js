/*
 * Small offline-safe subset of the jQuery API used by the generated UE4
 * HTML5 wrapper. Keeping this local removes the shell's dependency on a CDN,
 * which is required for offline installation and play.
 */
(function () {
    'use strict';

    function toElements(target) {
        if (typeof target === 'string') {
            return Array.prototype.slice.call(document.querySelectorAll(target));
        }
        return target ? [target] : [];
    }

    function api(target) {
        var elements = toElements(target);
        return {
            append: function (html) {
                elements.forEach(function (element) {
                    element.insertAdjacentHTML('beforeend', String(html));
                });
                return this;
            },
            prepend: function (html) {
                elements.forEach(function (element) {
                    element.insertAdjacentHTML('afterbegin', String(html));
                });
                return this;
            },
            empty: function () {
                elements.forEach(function (element) {
                    element.textContent = '';
                });
                return this;
            },
            remove: function () {
                elements.forEach(function (element) {
                    if (element.parentNode) element.parentNode.removeChild(element);
                });
                return this;
            },
            ready: function (callback) {
                if (target !== document) return this;
                if (document.readyState === 'loading') {
                    document.addEventListener('DOMContentLoaded', callback, { once: true });
                } else {
                    callback();
                }
                return this;
            }
        };
    }

    window.$ = window.jQuery = function (target) {
        return api(target);
    };
}());
