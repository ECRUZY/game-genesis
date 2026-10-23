/*
 * Общие настройки сайта: контакты и список разделов каталога.
 *
 * Новый раздел (например, шкафы):
 *   1. создайте data/wardrobes.js по образцу data/kitchens.js
 *      (window.CATALOG.wardrobes = [...]);
 *   2. положите фото в photos/wardrobes/ и запустите sh tools/make-thumbs.sh;
 *   3. подключите файл в index.html рядом с kitchens.js;
 *   4. добавьте раздел в categories ниже.
 */
window.SITE = {
  brand: "Forest Furniture",
  // Основной адрес сайта, например "https://forest-furniture.vercel.app/".
  // Пусто — берётся из личной ссылки админки или из адреса страницы.
  siteUrl: "https://ecruzy.github.io/forest-furniture/",
  phone: "+7 999 144-32-00",
  phoneHref: "tel:+79991443200",
  whatsapp: "79991443200",
  telegram: "deznthe",

  categories: [
    {
      id: "kitchens",             // ключ в window.CATALOG и папка в photos/
      title: "Кухни",
      one: "кухня",               // для сообщения: «Интересует кухня …»
      lead: "Готовые и модульные кухни от фабрик Юга России. Подберём размер под вашу комнату и привезём.",
      types: ["Прямая", "Угловая"],
      typeLabels: { "Прямая": "Прямые", "Угловая": "Угловые" },
    },
    // { id: "wardrobes", title: "Шкафы", one: "шкаф", lead: "…", types: ["Распашной", "Купе"],
    //   typeLabels: { "Распашной": "Распашные", "Купе": "Купе" } },
  ],
};
