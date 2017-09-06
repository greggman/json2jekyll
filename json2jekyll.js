const hanson = require('hanson');
const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const htmlparser = require("htmlparser2");
const DOMHandler = require("domhandler");
const _ = require('lodash');
const wrap80 = require('wordwrap')(80);
const entities = require('entities');

// =====================================
const processOnlyPrefix = process.argv[3] || '';

String.prototype.padStart = String.prototype.padStart || function(length = 0, chars = ' ') {
  return _.padStart(this, length, chars);
};

function safeName(str) {
  return str.replace(/[^a-zA-Z0-9-]/g, '_').toLowerCase();
}

const postsToIgnore = [
 "personal_b4_2006_09_30",
];
function ignorePosts(p) {
  return postsToIgnore.indexOf(p.post_name) < 0;
}

function convert(db, prefix, dstPath) {
  const posts = db[`${prefix}_posts`].filter(ignorePosts);

  const metaKeys = {};
  const metaById = {}
  db[`${prefix}_postmeta`].forEach((meta, ndx) => {
    const id = meta.post_id;
    if (!metaById[id]) {
      metaById[id] = {};
    }
    metaById[id][meta.meta_key] = meta.meta_value;
    metaKeys[meta.meta_key] = true;
  });

  const taxoIdToTermId = {};
  db[`${prefix}_term_taxonomy`].forEach((taxo) => {
    taxoIdToTermId[taxo.term_taxonomy_id] = taxo.term_id;
  });

  const termsById = {};
  db[`${prefix}_terms`].forEach((term) => {
    termsById[term.term_id] = term.name;
  });

  db[`${prefix}_term_relationships`].forEach((rel) => {
    const id = rel.object_id;
    if (!metaById[id]) {
      metaById[id] = {};
    }
    const meta = metaById[id];
    if (!meta.tags) {
      meta.tags = [];
    }
    const tags = meta.tags;
    const tag = termsById[taxoIdToTermId[rel.term_taxonomy_id]];
    if (tag && tags.indexOf(tag) < 0) {
      tags.push(tag);
    }
  });

  // console.log(Object.keys(metaKeys).join('\n'));
  // process.exit(1);

  // const postTypes = {};
  // posts.forEach((post,ndx) => {
  //   postTypes[post.post_type] = true;
  // });
  // console.log(Object.keys(postTypes).join('\n'));
  // process.exit(1);

  // "post_title": "TGA Thumbnails (and viewer) for Vista and Windows 7 both 32 and 64 bit",
  // "post_date_gmt": "2009-12-04 03:54:00",
  // "post_content":
  // "post_status": "publish",
  // "post_name": "tga_thumbnails__and_viewer__for_vista_and_windows_7_both_32_and_64_bit",
  // "post_type": "post",

  // meta:
  // gman_ja_excerpt
  // gman_ja_title
  // gman_ja_content
  // dsq_thread_id

  const ignoreTypes = {
    page: true,
    revision: true,
    attachment: true,
  };
  let untitledCount = 0;

  posts.forEach((post, ndx) => {
    if (ignoreTypes[post.post_type]) {
      return;
    }

    if (!post.post_content) {
      return;
    }

    if (post.post_type !== "post") {
      console.error(JSON.stringify(post));
      throw new Error("unhandled post type:", post.post_type);
    }

    if (post.post_status !== 'publish' &&
        post.post_status !== 'draft') {
      console.error(JSON.stringify(post));
      throw new Error("unhandled post status:", post.post_status);
    }

    // if (ndx > 1) {
    //   return;
    // }

    const isDraft = post.post_status === "draft";

    const meta = metaById[post.ID] || {};
    const date = post.post_date_gmt.substr(0, 10);
    const name = post.post_name
      ? post.post_name  // .replace(/_/g, '-')
      : safeName(post.post_title) || `untitled-${untitledCount++}`;
    const outname = isDraft
      ? `${date}-${name}.md`
      : `${date}-${name}.md`;
    const outPath = isDraft
      ? path.join(dstPath, '_drafts', outname)
      : path.join(dstPath, '_posts', outname);

    let printInfo = false;
    if (processOnlyPrefix) {
      if (!post.post_name.startsWith(processOnlyPrefix)) {
        return;
      }
      printInfo = true;
    }

    if (!isDraft && post.post_date_gmt.startsWith("0000")) {
      console.log(JSON.stringify(post, null, 2));
    }

    console.log('processsng', prefix, ':[', ndx, ']:', post.post_type, outPath);

    if (printInfo) {
      console.log("[META]", JSON.stringify(meta, null, 2));
      console.log("[POST]", JSON.stringify(post, null, 2));
    }

    const fm = {
      title: entities.decodeHTML(post.post_title),
      date: post.post_date_gmt.substring(0, 10),
      permalink: '/' + post.post_name + '/',
      tags: meta.tags,
    };

    if (meta.custom_post_template) {
      const m = /gman-custom-(.*?)\.php/.exec(meta.custom_post_template);
      fm.template = `${m[1]}.template`;
    }

    if (meta.gman_ja_content) {
      fm.langs = ['ja'];
    }

    if (meta.dsq_thread_id) {
      fm.dsq_thread_id = meta.dsq_thread_id;
    }

    const context = {
      post: post,
      outPath: outPath,
      depth: 0,
      markdownDepth: 0,
      fm: fm,
    };
    processPost(post, meta, context);

    if (meta.gman_ja_content) {
      const jaPost = Object.assign({}, post, {
        post_title: meta.gman_ja_title || post.post_title,
        post_content: entities.decodeHTML(meta.gman_ja_content),
      });
      const jaFm = Object.assign({}, fm, {
        title: entities.decodeHTML(jaPost.post_title),
        lang: 'ja',
      });
      const jaContext = Object.assign({}, context, {
        post: jaPost,
        outPath: path.join(path.dirname(outPath), 'ja', path.basename(outPath)),
        fm: jaFm,
      });
      processPost(jaPost, meta, jaContext);
    }

    function processPost(post, meta, context) {
      wp2Markdown(applyHacks(post.post_content), context).then((result) => {

        const output = [];
        output.push('---\n')

        try {
          output.push(yaml.safeDump(context.fm, {

          }));
        } catch (e) {
          console.error(e);
          console.error(JSON.stringify(context.fm));
          console.error(JSON.stringify(post));
          throw new Error("ff");
        }
        output.push('---\n');

        const all = output.concat(result);
        mkdirp(path.dirname(context.outPath));
        fs.writeFileSync(context.outPath, all.join('').replace(/\n\n\n\n/g, '\n\n').replace(/\n\n\n/g, '\n\n'));
      }).catch((err) => {
        console.log("----error----[", post.post_name, ']', err);
        console.log("META:", JSON.stringify(meta, null, 2));
        console.log("POST:", JSON.stringify(post, null, 2));
      });
    }
  });
}

function mkdirp(filepath) {
  if (!fs.existsSync(filepath)) {
    mkdirp(path.dirname(filepath));
    fs.mkdirSync(filepath);
  }
}

function applyHacks(str) {
  str = str.replace(/<!-- *more *-->/gi, '\n\n<!-- more -->\n\n');  // because <!-- more -->(*) vs \n(*)

  str = str.replace(/\[gmanposts category="(.*?)" tag="(.*?)"\]/g, (m, cat, tag) => {
    return `{{{postsbytag tags="${cat},${tag.replace(/_/g, '.')}" }}}`;
  });

  str = subEmoji(str);
  // for game/lets-debate-coding-style
  str = str.replace('table#mp3_list_table {\r\n   margin: 0.5em;', `table#mp3_list_table { border: 2px solid #ddd;` );
  str = str.replace('div#mp3_list_nontable {\r\n   margin: 0.5em;', `div#mp3_list_nontable { border: 2px solid #ddd;`);

  str = str.replace(/dir="ltr"/g, '');
  str = str.replace(/style="MARGIN-RIGHT:.*?"/g, '');

  str = str.replace(/<\/li>:\n/, ':</li>\n\n');

  const files = [
    { name: "nost", size: '.5',  filename: 'nostalgic-installer1.11b.exe', version: '1.11b', },
    { name: "cut",  size: '.68', filename: 'cutsprites.1.4.zip',           version: '1.4', },
  ];

  str = str.replace(/<!-- gmanNewestFile (.*?)-->/ig, (m0, m1) => {
    return `{{newestfileinfo ${m1.replace(/"/g,"'")}}}`;
  });

  str = str.replace(/\$newestfile\[(.*)\]/g, (m, args) => {
    const filename = args.replace(/^[\.\/]*/, '');
    const name = path.basename(filename);
    const dir = path.dirname(filename);
    return `{{newestfileinfo path="${dir}" name="${name}" cmd="path" }}`;
  });
  str = str.replace(/\$newestfile_name\[(.*)\]/g, (m, args) => {
    const filename = args.replace(/^[\.\/]*/, '');
    const name = path.basename(filename);
    const dir = path.dirname(filename);
    return `{{newestfileinfo path="${dir}" name="${name}" cmd="name" }}`;
  });
  str = str.replace(/\$newestfile_size\[(.*)\]/g, (m, args) => {
    const parts = args.split('|');
    const filename = args[2].replace(/^[\.\/]*/, '');
    const name = path.basename(filename);
    const dir = path.dirname(filename);
    return `{{newestfileinfo path="${dir}" name="${name}" cmd="size" format="${args[0]}" divisor="${args[1]}" }}`;
  });

  str = str.replace(/<\/*gat_nobr>/gi, '');
  str = str.replace(/<gman_cuthere>/gi, '\n\n<!-- more -->\n\n');
  str = str.replace(/<\/gman_cuthere>/gi, '');

  str = str.replace(/<gatcode.*?>/gi, (m) => {
    throw new Error("gatcode:" + m);
  });

  //str = str.replace(/<blockquote><pre>/g, '<pre class="prettyprint">');
  //str = str.replace(/<\/blockquote><\/pre>/g, '</pre>');

  str = str.replace(/\(#(\d+)#\)/, '&#$1;');
  str = str.replace(/<a\/>/g, '</a>');
  str = str.replace(/([\."])<([^abp/])/g, '$1&lt;$2');
  str = str.replace(/font-family: "Terminal";/g, 'font-family: monospace;');
  str = str.replace(/<ahref=/g, '<a href=');
  str = str.replace(/<pre(.*?)>([\s\S]*?)<\/pre>/g, (m0, m1, m2) => {
    if (m1.indexOf("prettyprint") >= 0) {
      //if (m2.indexOf('&amp;') >= 0) {
      //  throw new Error("already &amp; in pre");
      //}
      m2 = m2.replace(/&/g, '&amp;');
      m2 = m2.replace(/</g, '&lt;');
    }
    //  <foo &lt; foo>
    //  <foo &amp;lt; foo>
    //  &lt;foo &amp;lt; foo>
    //  <foo &amp;lt; foo>
    //  <foo &lt; foo>

    return `<pre${m1}>${m2}</pre>`;
  });

  str = str.replace(/([^&])#(\d+)/g, '$1&#0035;$2');

  return str;
}

const voidElements = {
  area: true,
  base: true,
  br: true,
  col: true,
  embed: true,
  hr: true,
  img: true,
  input: true,
  link: true,
  meta: true,
  param: true,
  source: true,
  track: true,
  wbr: true,
};

const blockElements = {
  h1: true,
  h2: true,
  h3: true,
  h4: true,
  h5: true,
  blockquote: true,
  div: true,
  ol: true,
  ul: true,
  pre: true,
};

function makeRE(sub) {
  const re = '(.)(' + sub.replace(/([\[\]\)\|\(\?\*])/g, '\\$1') + ')';
  return new RegExp(re, 'g');
}

const emoji = [
  //{ re: makeRE(     ';)'), sub: "&#128521;", }, // "\xf0\x9f\x98\x89",  // this needs to be first because it converts semi-colon
  { re: makeRE(':smile:'), sub: "&#128522;", }, //"\xf0\x9f\x99\x82",
  { re: makeRE( ':cool:'), sub: "&#128526;", }, // "\xf0\x9f\x98\x8e",
  { re: makeRE( ':evil:'), sub: "&#128520;", }, //"\xf0\x9f\x91\xbf",
  { re: makeRE( ':grin:'), sub: "&#128512;", }, // "\xf0\x9f\x98\x80",
  { re: makeRE( ':idea:'), sub: "&#129300;", }, // "\xf0\x9f\x92\xa1",
  { re: makeRE( ':roll:'), sub: "&#128580;", }, // "\xf0\x9f\x99\x84",
  { re: makeRE( ':wink:'), sub: "&#128521;", }, // "\xf0\x9f\x98\x89",
  { re: makeRE(  ':cry:'), sub: "&#128557;", }, // \xf0\x9f\x98\xa5",
  { re: makeRE(  ':sad:'), sub: "&#128542;", }, // "\xf0\x9f\x99\x81",
  { re: makeRE(    '8-)'), sub: "&#128526;", }, // "\xf0\x9f\x98\x8e",
  { re: makeRE(    ':-('), sub: "&#128542;", }, // "\xf0\x9f\x99\x81",
  { re: makeRE(    ':-['), sub: "&#128520;", }, // "\xf0\x9f\x99\x81",
  { re: makeRE(    ':-)'), sub: "&#128522;", }, // "\xf0\x9f\x99\x82",
  { re: makeRE(    ':-?'), sub: "&#128533;", }, //"\xf0\x9f\x98\x95",
  { re: makeRE(    ':-D'), sub: "&#128515;", }, // \xf0\x9f\x98\x80",
  { re: makeRE(    ':-d'), sub: "&#128515;", }, // \xf0\x9f\x98\x80",
  { re: makeRE(    ':-P'), sub: "&#128539;", }, // "\xf0\x9f\x98\x9b",
  { re: makeRE(    ':-p'), sub: "&#128539;", }, // "\xf0\x9f\x98\x9b",
  { re: makeRE(    ':-o'), sub: "&#128558;", }, // "\xf0\x9f\x98\xae",
  { re: makeRE(    ':-O'), sub: "&#128558;", }, // "\xf0\x9f\x98\xae",
  { re: makeRE(    ':-x'), sub: "&#129326;", }, // "\xf0\x9f\x98\xa1",
  { re: makeRE(    ':-S'), sub: "&#128534;", },
  { re: makeRE(    ':-s'), sub: "&#128534;", },
  { re: makeRE(    ':-Q'), sub: "&#x1F922;", }, // "\xf0\x9f\x98\xa1",
  { re: makeRE(    ':-|'), sub: "&#128528;", }, // "\xf0\x9f\x98\x90",
  { re: makeRE(    ';-)'), sub: "&#128521;", }, // "\xf0\x9f\x98\x89",
  { re: makeRE(     ':('), sub: "&#128526;", }, // "\xf0\x9f\x99\x81",
  { re: makeRE(     ':)'), sub: "&#9786;", }, // "\xf0\x9f\x99\x82",
  { re: makeRE(     ':?'), sub: "&#128533;", }, // "\xf0\x9f\x98\x95",
  { re: makeRE(     ':D'), sub: "&#128515;", }, // "\xf0\x9f\x98\x80",
  { re: makeRE(     ':P'), sub: "&#128539;", }, // "\xf0\x9f\x98\x9b",
  { re: makeRE(     ':o'), sub: "&#128558;", }, // "\xf0\x9f\x98\xae",
  { re: makeRE(     ':x'), sub: "&#129326;", }, // "\xf0\x9f\x98\xa1",
  { re: makeRE(     ':Q'), sub: "&#x1F922;", }, // "\xf0\x9f\x98\xa1",
  { re: makeRE(     ':|'), sub: "&#128528;", }, // "\xf0\x9f\x98\x90",
  { re: makeRE(    '(Y)'), sub: "&#128077;", }, //  => '<img border="0" src="tup.gif">',
  { re: makeRE(    '(y)'), sub: "&#128077;", }, //  => '<img border="0" src="tup.gif">',
  { re: makeRE(    '(N)'), sub: "&#128078;", }, //  => '<img border="0" src="tdown.gif">',
  { re: makeRE(    '(n)'), sub: "&#128078;", }, //  => '<img border="0" src="tdown.gif">',
  { re: makeRE(    '(L)'), sub: "&#x2764;&#xFE0F;", }, //  => '<img border="0" src="love.gif">',
  { re: makeRE(    '(l)'), sub: "&#x2764;&#xFE0F;", }, //  => '<img border="0" src="love.gif">',
  { re: makeRE(    '(U)'), sub: "&#128148;", }, //  => '<img border="0" src="kanashi.gif">',
  { re: makeRE(    '(u)'), sub: "&#128148;", }, //  => '<img border="0" src="kanashi.gif">',
  { re: makeRE(    '(K)'), sub: "&#128139;", }, //  => '<img border="0" src="kiss.gif">',
  { re: makeRE(    '(k)'), sub: "&#128139;", }, //  => '<img border="0" src="kiss.gif">',
  { re: makeRE(    '(G)'), sub: "&#127873;", }, //  => '<img border="0" src="gift.gif">',
  { re: makeRE(    '(g)'), sub: "&#127873;", }, //  => '<img border="0" src="gift.gif">',
  { re: makeRE(    '(F)'), sub: "&#127801;", }, //  => '<img border="0" src="rose.gif">',
  { re: makeRE(    '(f)'), sub: "&#127801;", }, //  => '<img border="0" src="rose.gif">',
  { re: makeRE(    '(X)'), sub: "&#128698;", }, //  => '<img border="0" src="woman.gif">',
  { re: makeRE(    '(x)'), sub: "&#128698;", }, //  => '<img border="0" src="woman.gif">',
  { re: makeRE(    '(Z)'), sub: "&#128697;", }, //  => '<img border="0" src="man.gif">',
  { re: makeRE(    '(z)'), sub: "&#128697;", }, //  => '<img border="0" src="man.gif">',
  { re: makeRE(    '(P)'), sub: "&#128247;", }, //  => '<img border="0" src="cam.gif">',
  { re: makeRE(    '(p)'), sub: "&#128247;", }, //  => '<img border="0" src="cam.gif">',
  { re: makeRE(    '(B)'), sub: "&#127866;", }, //  => '<img border="0" src="rootbeer.gif">',
  { re: makeRE(    '(b)'), sub: "&#127866;", }, //  => '<img border="0" src="rootbeer.gif">',
  { re: makeRE(    '(D)'), sub: "&#127863;", }, //  => '<img border="0" src="drink.gif">',
  { re: makeRE(    '(d)'), sub: "&#127863;", }, //  => '<img border="0" src="drink.gif">',
  { re: makeRE(    '(T)'), sub: "&#128241;", }, //  => '<img border="0" src="cell.gif">',
  { re: makeRE(    '(t)'), sub: "&#128241;", }, //  => '<img border="0" src="cell.gif">',
  { re: makeRE(    '(@)'), sub: "&#65312;", }, //   => '<img border="0" src="at.gif">',
  { re: makeRE(    '(C)'), sub: "&#9749;", }, //  => '<img border="0" src="cup.gif">',
  { re: makeRE(    '(c)'), sub: "&#9749;", }, //  => '<img border="0" src="cup.gif">',
  { re: makeRE(    '(I)'), sub: "&#128161;", }, //  => '<img border="0" src="idea.gif">',
  { re: makeRE(    '(i)'), sub: "&#128161;", }, //  => '<img border="0" src="idea.gif">',
  { re: makeRE(    '(H)'), sub: "&#x2600;&#xFE0F;", }, //  => '<img border="0" src="sun.gif">',
  { re: makeRE(    '(h)'), sub: "&#x2600;&#xFE0F;", }, //  => '<img border="0" src="sun.gif">',
  { re: makeRE(    '(S)'), sub: "&#127769;", }, //  => '<img border="0" src="moon.gif">',
  { re: makeRE(    '(s)'), sub: "&#127769;", }, //  => '<img border="0" src="moon.gif">',
  { re: makeRE(    '(*)'), sub: "&#x2B50;&#xFE0F;", }, // => '<img border="0" src="star.gif">',
  { re: makeRE(    '(8)'), sub: "&#127925;", }, //  => '<img border="0" src="music.gif">',
  { re: makeRE(    '(E)'), sub: "&#x2709;&#xFE0F;", }, //  => '<img border="0" src="futo.gif">',
  { re: makeRE(    '(e)'), sub: "&#x2709;&#xFE0F;", }, //  => '<img border="0" src="futo.gif">',
  { re: makeRE(    '(M)'), sub: "&#127828;", }, //  => '<img border="0" src="baga.gif">',
  { re: makeRE(    '(m)'), sub: "&#127828;", }, //  => '<img border="0" src="baga.gif">',

];

function subEmoji(s) {
  emoji.forEach((e) => {
    s = s.replace(e.re, (m, b4, code) => {
      return b4 === '\\' ? code : b4 + e.sub;
    });
  });
  return s;
}

function tab(depth) {
  return `${''.padStart(depth * 2)}[${depth}]: `;
}

function wp2Markdown(wp, context) {
  // console.log(tab(depth), "wp2m:");
  return new Promise((resolve, reject) => {
    const handler = new DOMHandler(function(err, dom) {
      if (err) {
        reject(err);
      } else {
        if (context.markdownDepth === 0) {
          prepDOMChildren(dom);
        }
        writeChildren(dom, context).then((result) => { resolve(result); });
      }
    });
    const parser = new htmlparser.Parser(handler, { recognizeSelfClosing: true });
    parser.write(wp);
    parser.end();
  });
}

function prepDOMChildren(nodes) {
  nodes.forEach((node, ndx) => {
    const prev = nodes[ndx - 1];
    const next = nodes[ndx + 1];
    if (node.type === 'text') {
      // remove CR
      node.data = node.data.replace(/\r/g, '');
      if (node.data.trim().length > 0) {
        // if the previous node is a tag
        // and we start with \n and there's only one then
        // add a \n
        //
        // this is to fix situations like ths
        //
        //    <div>html</div>
        //    some markdown
        //
        // into
        //
        //    <div>html</div>
        //
        //    some markdown
        //
        if (prev && prev.type === 'tag') {
          if (node.data.startsWith('\n') && !node.data.startsWith('\n\n')) {
            node.data = '\n' + node.data;
          } else if (blockElements[prev.name]) {
            if (!node.data.startsWith('\n\n')) {
              if (!node.data.startsWith('\n')) {
                node.data = '\n\n' + node.data;
              } else {
                node.data = '\n' + node.data;
              }
            }
          }
        }
        // if the next node is a tag
        // and we end with \n and there's only one then
        // add a \n
        //
        // this is to fix situations like ths
        //
        //    some markdown
        //    <div>html</div>
        //
        // into
        //
        //    some markdown
        //
        //    <div>html</div>
        //
        if (next && next.type === 'tag') {
          //console.log("nd:", JSON.stringify(node.data));
          //console.log(JSON.stringify("node.data.endsWith('\n')"), node.data.endsWith('\n'));
          //console.log(JSON.stringify("node.data.endsWith('\n\n')"), node.data.endsWith('\n\n'));

          //if ((/\n *$/).test(node.data) && !(/\n\n *$/).test(node.data)) {
          if (node.data.endsWith('\n') && !node.data.endsWith('\n\n')) {
            //console.log("rep!");
            node.data = node.data + '\n';
            //node.data = node.data.replace('\n( *)$', '\n\n$1');
          }
        }
      }
    } else if (node.type === 'comment') {
      if (next && next.type === 'tag' && next.name === 'pre') {
        next.children[0].data = '/* ' + node.data + ' */\n' + next.children[0].data;
        next.attribs['class'] = 'prettyprint';
        node.type = 'text';
        node.data = '';
      }
    } else if (node.type === 'tag') {
    }
  });
}

function writeChildren(nodes, context) {
  return Promise.all(nodes.map((node) => {
    return writeNode(node, context);
  })).then((arrays) => {
    // have to flatten as each element is an array
    // this will also magically filter out empty arrays
    return [].concat.apply([], arrays);
  });
}


function writeNode(node, context) {
  switch (node.type) {
    case 'text':
      if (context.depth === 0) {
        return markdownify(node.data, context);
      } else {
        return Promise.resolve([removeCR(node.data)]);
      }
    case 'tag': {
      let name = node.name.toLowerCase();
      switch (name) {
        case 'a': {
          if (context.depth === 0) {
            const output = [];
            // If it has no alt and no children?
            if (writeSimpleLink(node, output)) {
              return Promise.resolve(output);
            }
          }
          break;
        }
        case 'p':
          if (context.depth === 0 && (!node.attribs || Object.keys(node.attribs).length === 0)) {
            return writeChildren(node.children, context).then((output) => {
              output.push('\n\n');
              output[0] = output[0].replace(/^ +/, '');
              output.unshift('\n\n');
              return output;
            });
          }
          break;
        case 'pre':
          if (context.depth === 0) {
            const output = [];
            if (writeCodeSample(node, output)) {
              return Promise.resolve(output);
            }
          }
          break;
        case 'code':
          if (context.depth === 0 || context.markdownDepth > 0) {
            const output = [];
            if (writeCodeSpan(node, output)) {
              return Promise.resolve(output);
            }
          }
          break;
        case 'img':
          if (node.attribs.align === 'left' || node.attribs.align === 'right') {
            context.fm.old = `true`;
          }
          break;
        case 'table':
          if (node.attribs.align === 'left' || node.attribs.align === 'right') {
            context.fm.old = `true`;
          }
          break;
        case 'font': {
          name = 'span';
          const oldColor = node.attribs.color;
          if (oldColor) {
            const color = 'oldfont_' + safeName(oldColor);
            node.attribs['class'] = color;
            delete node.attribs.color;
          }
          break;
        }
        case 'hr':
          return Promise.resolve(['\n\n---\n\n']);
        case 'h1':
        case 'h2':
        case 'h3':
        case 'h4':
        case 'h5':
          if (context.depth === 0) {
            const output = [];
            if (writeHeading(node, output)) {
              return Promise.resolve(output);
            }
          }
          break;
        case 'html':
          context.fm.template = context.fm.template || 'html.template';
          break;
        case 'embed':
          throw new Error("embed tag");
        case 'object':
          return Promise.resolve(convertObjectToIFrame(node));
      }

      if (voidElements[name]) {
        return Promise.resolve([`<${name}${writeAttribs(node.attribs)} />`]);
      } else {
        return writeChildren(node.children, Object.assign({}, context, { depth: context.depth + 1 })).then((array) => {
          return [
           `<${name}${writeAttribs(node.attribs)}>`,
            ...array,
            `</${name}>`
          ];
        });
      }
    }
    case 'comment': {
      return Promise.resolve([`<!--${removeCR(node.data)}-->`]);
    }
    case 'style': {
      return writeChildren(node.children, Object.assign({}, context, { depth: context.depth + 1 })).then((array) => {
        return ['<style>', ...array, '</style>'];
      });
    }
    case 'script':
      console.warn("script found in:", context.post.post_name);
      return Promise.resolve([]);
    case 'directive':
      return Promise.resolve([]);
    default:
      throw new Error(`unhandled node type: ${node.type} ${node.data} ${node.children}`);
  }
}

// <OBJECT classid=\"clsid:D27CDB6E-AE6D-11cf-96B8-444553540000\" codebase=\"http://download.macromedia.com/pub/shockwave/cabs/flash/swflash.cab#version=5,0,0,0\" WIDTH=375 HEIGHT=262>
//   <PARAM NAME=movie VALUE=\"example.swf\">
//   <PARAM NAME=quality VALUE=high>
//   <PARAM NAME=bgcolor VALUE=#FFFFFF>
//   <EMBED src=\"/nostalgic/example.swf\" quality=high bgcolor=#FFFFFF WIDTH=375 HEIGHT=262 TYPE=\"application/x-shockwave-flash\" PLUGINSPAGE=\"http://www.macromedia.com/shockwave/download/index.cgi?P1_Prod_Version=ShockwaveFlash\"></EMBED>
// </OBJECT>

function convertObjectToIFrame(node) {
  const embed = node.children.filter(n => n.name.toLowerCase() === 'embed')[0];
  const output = [
    `<iframe width="${node.attribs.width}" height="${node.attribs.height}" src="${embed.attribs.src}.html" style="border: 0;"></iframe>`,
  ];
  return output;
}

function writeCodeSample(node, output) {
  const hasAttribs = node.attribs;
  const has1Attrib = node.attribs && Object.keys(node.attribs).length === 1;
  const hasClassPrettyprint = node.attribs['class'] && node.attribs['class'].indexOf('prettyprint') >= 0;
  const hasAtLeastOneChild = node.children && node.children.length > 0;
  if (!hasAttribs || !has1Attrib || !hasClassPrettyprint || !hasAtLeastOneChild) {
    return false;
  }

  if (node.children.length > 1) {
    throw new Error('prettyprint pre with more than 1 child nodes');
  }

  const langClass = node.attribs['class'].split(' ').filter(l => l.startsWith('lang-'))[0];
  const lang = langClass ? langClass.substr(5) : '';

  const child = node.children[0];
  const childIsText = child.type === 'text';
  const childHasNoChildren = !child.children || child.children.length === 0;

  if (!childIsText || !childHasNoChildren) {
    return false;
  }

  let source = removeCR(node.children[0].data);

  // unapply fix from applyHacks above
  source = source.replace(/&lt;/g, '<');
  source = source.replace(/&amp;/g, '&');

  // we need to do this because originally these were acutally HTML
  source = source.replace(/&lt;/g, '<');
  source = source.replace(/&gt;/g, '>');

  source = source.replace(/^\n/g, '');

  output.push('\n\n```', lang, '\n');
  output.push(source);
  output.push('\n```\n\n');
  return true;
}

function writeHeading(node, output) {
  const hasNoAttribs = !node.attribs || Object.keys(node.attribs).length === 0;
  const hasOneChild = node.children && node.children.length === 1;

  if (!hasNoAttribs || !hasOneChild) {
    return false;
  }

  const child = node.children[0];
  const childIsText = child.type === 'text';
  const childHasNoChildren = !child.children || child.children.length === 0;

  if (!childIsText || !childHasNoChildren) {
    return false;
  }

  output.push(`\n\n${''.padStart(parseInt(node.name.substr(1)), '#')} ${node.children[0].data}\n\n`);
  return true;
}


function writeSimpleLink(node, output) {
  // only href
  // only 1 child
  const hasAttribs = node.attribs;
  const has1Attrib = node.attribs && Object.keys(node.attribs).length === 1;
  const hasHref = node.attribs.href;
  const hasOneChild = node.children && node.children.length === 1;

  if (!hasAttribs || !has1Attrib || !hasHref || !hasOneChild) {
    return false;
  }

  const child = node.children[0];
  const childIsText = child.type === 'text';
  const childHasNoChildren = !child.children || child.children.length === 0;

  if (!childIsText || !childHasNoChildren) {
    return false;
  }

  output.push(`[${node.children[0].data}](${node.attribs.href})`);
  return true;
}

function writeCodeSpan(node, output) {
  // only 1 child
  const hasNoAttribs = !node.attribs || Object.keys(node.attribs).length === 0;
  const hasOneChild = node.children && node.children.length === 1;

  if (!hasNoAttribs || !hasOneChild) {
    return false;
  }

  const child = node.children[0];
  const childIsText = child.type === 'text';
  const childHasNoChildren = !child.children || child.children.length === 0;

  if (!childIsText || !childHasNoChildren) {
    return false;
  }

  let text = node.children[0].data;

  if (text.indexOf("<") >= 0) {
    throw new Error("< inside code span");
  }

  if (text.indexOf('&') >= 0) {
    return false;
  }

  // we need to do this because originally these were acutally HTML
  text = text.replace(/&lt;/g, '<');
  text = text.replace(/&gt;/g, '>');

  output.push(`\`${text}\``);
  return true;
}

function quotes(s) {
  if (s.indexOf('"') >= 0) {
    return `'${s}'`;
  } else {
    return `"${s}"`;
  }
}

function writeAttribs(attribs) {
  const pairs = [];
  Object.keys(attribs).forEach((key) => {
    let value = attribs[key];
    pairs.push(`${key}=${quotes(_.escape(value))}`);
  });
  return pairs.length ? ` ${pairs.join(' ')}` : '';
}

function markdownify(str, context) {
  str = str.replace(/\$TMPLT_INCLUDE\[(.*?)\]/g, (m0, m1) => {
    return '<div>--no longer exists--</div>';
  });
  str = str.replace(/\$newestfile_version\[(.*?)\]/g, (m0, m1) => {
    return '--no longer exists--';
    return '';
  });
  // str = str.replace(/(\$[a-z]+)/ig, (m0, m1) => {
  //   console.log("fixme: '", m1, "'");
  //   console.log(JSON.stringify(context.post, null, 2));
  //   return '';
  // });
  if (context.markdownDepth === 0) {
    // console.log(tab(depth), "===> md0");
    return wp2Markdown(expandWordpressCode(str, context), Object.assign({}, context, { markdownDepth: context.markdownDepth + 1 }));
  } else {
    // console.log(tab(depth), "===> md1");
    str = str.replace(/\*/g, '&ast;');
    str = str.replace(/([^&])#/g, '$1&num;');
    str = str.replace(/\[/g, '&lsqb;');
    str = str.replace(/`/g, '&grave;');
    str = str.replace(/\~/g, '&tilde;');
    str = str.replace(/_/g, '&lowbar;');
    str = str.replace(/>/g, '&gt;');
    str = str.replace(/</g, '&lt;');
    str = str.replace(/-/g, '&minus;');
    str = str.replace(/([ \n]\d+)\. /g, '$1\\. ');
    str = removeCR(str);
    str = wrap80(str);
  }
  return Promise.resolve([str]);
}

function removeCR(str) {
  return str.replace(/\r/g, '');
}

const shortCodeExpansions = {};
shortCodeExpansions['*'] = '*';
shortCodeExpansions['global'] = '<code>global</code>';
shortCodeExpansions['width*height*sizeof8x8char'] = '[width*height*sizeof8x8char]';
shortCodeExpansions['numSprites'] = '[numSprites]';
shortCodeExpansions['numsprites'] = '[numsprites]';
shortCodeExpansions['numsprites*sizeof8x8char'] = '[numsprites*sizeof8x8char]';
shortCodeExpansions['n-generate'] = '[n-generate]';
shortCodeExpansions['spoiler'] = '<span class="spoiler">';
shortCodeExpansions['/spoiler'] = '</span>';
shortCodeExpansions['Sex and the City'] = '[Sex and the City]';
shortCodeExpansions['&#x2B50;&#xFE0F;:G35TFR'] = '[&#x2B50;&#xFE0F;:G35TFR]';

function expandWordpressCode(str, context) {
  return str.replace(/\[([^\]]+)\]/g, (m0, m1) => {
    const sub = shortCodeExpansions[m1];
    if (sub) {
      return sub;
    }
    throw new Error(`unhandled wp code: ${m0} ${m1}`);
  });
}

if (false) {
  const test = `
<ul>
    <li>test</li>
    <li>foo<p>bar
</ul>
  `;
  const fm = {
  };
  const context = {
    //post: post,
    //outPath: outPath,
    depth: 0,
    markdownDepth: 0,
    fm: fm,
  };
  wp2Markdown(applyHacks(test), context).then((result) => {
    try {
      console.log("done:\n", result);
    } catch (e) {
      console.error(e);
      throw new Error("ff");
    }
  }).catch((err) => {
  });
} else {
  const filename = process.argv[2];
  console.log("load:", filename);
  const src = fs.readFileSync(filename, {encoding: 'utf8'});
  const obj = hanson.parse(src);

  // function tlog(name) {
  //   console.log('==========[', name);
  //   console.log(JSON.stringify(obj[name], null, 2));
  // }
  //
  // tlog('table_wpgame_terms');
  // tlog('table_wpgame_term_relationships');
  // tlog('table_wpgame_term_taxonomy');
  // tlog('table_wpgame_posts');
  // process.exit(0);

  //convert(obj, 'table_wpgame', '/Users/gregg/temp/delme-gman-test/games.greggman.com/game');
  //convert(obj, 'table_wpblog', '/Users/gregg/temp/delme-gman-test/games.greggman.com/blog');

  convert(obj, 'table_happyfun_wp', 'out');

}
