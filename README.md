# JSON2Jekyll

This is a script I hacked together to convert my wordpress blog to
something like Jekyll. It's not meant as a drop in solution, rather
you might hack it some more for your needs

You can install and run it like this

    git clone https://github.com/greggman/json2jekyll.git
    cd json2jekyll
    npm install
    node json2jekyll path/to/wordpress-db.json

It will read the specified wordpress json file and output `_posts` and `_drafts`
entries to the `out` folder in the current directory.

Note that as it's running from the raw data it can't take into account
any wordpress plugins you have and you'll have to add custom code to
handle those.

## Getting a wordpress json file

Many wordpress sites are install on systems with "phpMyAdmin" accessable through
"cpanel" or other means. Go into "phpMyAdmin", select your database, pick the
"export" tab. Select "json" and also scroll down and pick "pretty print" or
"make human readable".

Note that for some unknown reason phpMyAdmin doesn't actually support real
JSON because it adds comments which are illegal in JSON. Why they did this
I have no idea.

On of that they put the table names in comments instead of actually making
them data which would have been 100x more useful.

Here's an example of the data as output from "phpMyAdmin"

```
/**
 Export to JSON plugin for PHPMyAdmin
 @version 4.6.6
 */

// Database 'gamevets_hft'

// gamevets_hft.happyfun_wp_commentmeta

[{
    "meta_id": "1",
    "comment_id": "2",
    "meta_key": "dsq_parent_post_id",
    "meta_value": ""
}, {
    "meta_id": "2",
    "comment_id": "2",

...

    "user_email": "happyfuntimes@greggman.com",
    "user_url": "",
    "user_registered": "2014-06-09 04:56:27",
    "user_activation_key": "",
    "user_status": "0",
    "display_name": "greggman"
}]
```

To fix it I loaded it into my text editor and did a search and replace of
`s/\/\/ gamevets_hft\.(.?*)$/,"table_$1":/`

I then removed the extra comma at the top of the file and added a closing `}`.
I then deleted the comments at the top so it ended up like this

```
{"table_happyfun_wp_commentmeta":

[{
    "meta_id": "1",
    "comment_id": "2",
    "meta_key": "dsq_parent_post_id",
    "meta_value": ""
}, {
    "meta_id": "2",
    "comment_id": "2",

...

    "user_status": "0",
    "display_name": "greggman"
}]

  }
```


It's now actual JSON and super easy to use in JavaScript.

## Code notes

* selecting the database tables

  At the bottom of `json2jekyll.js` there is a call to `convert`.
  The first arugment is the entire json database. The second
  argument is the table name prefix used for your wordpress
  database. The 3rd argument is the path to write the output.

* if you pass a 2nd argument only posts that start with that argument
  will be processed. When they are processed they will have their
  json dumped to the console. It's an easy way to see the data
  before it has been processed.

* `postsToIgnore`

  names of posts to ignore

* `applyHacks`

  Is just a function trying to replace very blog specific things before
  any the processing has happened. It is passed a string that is the
  content of a post from wordpress. It returns the processed string.

* `writeNode`

  The wordpress content is passed to `DOMHandler` via `htmlparser2`.
  It is then processed as a DOM allowing easier handling of various
  conversions. The core of that processing is in `writeNode` where you
  can check for specific tags and or specific depths in the DOM.

  `context.depth` is the depth in the DOM hierarchy.
  `context.markdownDepth` is the depth in markdown processing for those
   cases when their is recursive markdown

   Looking through that code you can see several places where
   if it's a certain tag AND that tag has exactly one child
   and that tag as a certain attribute then it outputs some code.
   Otherwise it falls through.

* `expandWordpressCode`

  attempts to find wordpress codes and change them into HTML. Note
  I rarely used wordpress shortcodes.

## LICENSE (MIT)

Copyright 2017, Gregg Tavares.

All rights reserved.

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions are
met:

*   Redistributions of source code must retain the above copyright
    notice, this list of conditions and the following disclaimer.

*   Redistributions in binary form must reproduce the above
    copyright notice, this list of conditions and the following disclaimer
    in the documentation and/or other materials provided with the
    distribution.

*   Neither the name of Gregg Tavares. nor the names of its
    contributors may be used to endorse or promote products derived from
    this software without specific prior written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS
"AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT
LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR
A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT
OWNER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL,
SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT
LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE,
DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY
THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
(INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.


