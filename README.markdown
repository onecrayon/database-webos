## Introduction

The Database class provides methods for working with HTML 5 SQLite
databases in Palm's WebOS. It offers versions for both Enyo and
Mojo (Enyo version is a Component, Mojo version a Prototype class).
You can find full reference documentation within the inline comments
or at http://onecrayon.github.com/database-webos

## Installation

To use the class, download either database-mojo.js or database-enyo.js
and put it somewhere in your app (I usually use a top-level javascripts
folder for this kind of generic script).

### Enyo (webOS 3.0+, Enyo 2-compatible)

Add a reference to the file in your appropriate depends.js file:

    enyo.depends(
        "javascripts/database-enyo.js"
    );

And then in your kind add the onecrayon.Database kind to your components:

    components: [
        {
            name: "db",
            kind: "onecrayon.Database",
            database: 'ext:MyDatabase',
            version: "",
            debug: false
        }
    ]

After your `create` method has been called, you will then be able to access
the database methods using `this.$.db` (in this case; may be different if you
named it differently). So for instance:

    this.$.db.setSchemaFromURL('schemas/schema.json', {
        onSuccess: enyo.bind(this, this.finishFirstRun)
    });

### Mojo (webOS 1.x-2.x)

Add the following line to your `sources.json` file:

    {"source": "javascripts/database.js"}

And then in any of your assistants or other Javascript files you
should be able to instantiate the class like so:

    var db = new Database('ext:my_database', {version: '1', estimatedSize: 1048576});

## Documentation

Currently all documentation for the class is inline in the source code.
In particular, you should read the comments for `setSchema`, `query`,
and `queries` as these are the main methods you will need in everyday usage.

## Changelog

**2.1**

- Now supports Enyo 2.0; thanks Scott Miles!

**2.0**

- Rewritten from the ground up for Enyo

## In the wild

The Database class is developed for and used by [TapNote][1].

Let me know if you are using it, and I will note it here.

   [1]: http://onecrayon.com/tapnote/

## Released under an MIT license

Copyright (c) 2010-2012 Ian Beck

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.
