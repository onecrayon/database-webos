/*
---

script: database.js

description: Provides an interface to HTML 5 database objects for WebOS using Prototype.js classes

license: MIT license <http://www.opensource.org/licenses/mit-license.php>

authors:
- Ian Beck

version: 1.0.0

Core class design based on the Mootools Database class by André Fiedler:
http://github.com/SunboX/mootools-database/

Schema definitions based on Mojo Database Helper Objects, author unknown:
http://webos101.com/Mojo_Database_Helper_Objects

...
*/

/*
Database (class)

This is the class you'll be using in your own code. Provides shortcuts
to common HTML 5 SQLite database operations.

Parameters:
- name (string, required): prefix with ext: to allow >1 MB sizes
- options (object):
	* version (string): version of the database you want to open/create
	* estimatedSize (int): estimated size in bytes

USAGE:
var db = new Database('ext:my_database', {version: 1, estimatedSize: 1048576});
*/

var Database = Class.create({
	// === Class constructor ===
	initialize: function(name, options) {
		// Name is required, enforce that
		if (Object.isUndefined(name) || name == '') {
			Mojo.Log.error('Database: you must define a name for your database when instantiating the class.');
			return;
		} else {
			this.dbName = name;
		}
		// Just to make sure people are aware...
		if (this.dbName.indexOf('ext:') != 0) {
			Mojo.Log.warn('Database: you are working with an internal database, which will limit its size to 1 MB. Prepend `ext:` to your database name to remove this restriction.');
		}
		// Make sure there's something available as options
		var options = (!Object.isUndefined(options) ? options : {});
		// Default options; oh, Mootools, how I miss thee
		this.options = new Hash({
			version: '1',
			estimatedSize: null
		});
		// Merge our passed options into the default options
		this.options = this.options.merge(options).toObject();
		// Open our database connection
		// parameters: name, version, displayName [unused in WebOS], target size
		this.db = openDatabase(this.dbName, this.options.version, '', this.options.estimatedSize);
		// Make sure everything is peachy
		if (!this.db) {
			Mojo.Log.error('Database: failed to open database named ' + this.dbName);
			return null;
		}
		// Save the database version, in case it differs from options
		this.dbVersion = this.db.version;
		// Setup a dummy last insert row ID
		this.lastInsertRowId = 0;
	},
	
	
	// === Standard database methods ===
	
	/* Fetch the version of the database */
	getVersion: function() {
		return this.dbVersion;
	},
	
	/*
	UNTESTED
	
	Change the version of the database; allows porting data when upgrading schema
	*/
	changeVersion: function(from, to) {
		this.db.changeVersion(from, to);
		this.dbVersion = to;
	},
	
	/* Exposes the last ID inserted */
	lastInsertID: function() {
		return this.lastInsertRowId;
	},
	
	/*
	Close the database connection
	
	Why you'd want to do this, I don't know; may as well support it, though
	*/
	close: function() {
		this.db.close();
	},
	
	/*
	Destroy the entire database for the given version (if passed)
	
	If only there were a way to actually do this...
	*/
	destroy: function(version) {
		Mojo.Log.info('Database: there is currently no way to destroy a database. Hopefully we will be able to add this in the future.');
	},
	
	/*
	Execute an arbitrary SQL command on the database.
	
	If you need to execute multiple commands in a transaction, use queries()
	
	Parameters:
	- sql (string or query object, required)
	- options (object):
		* values (array): replacements for '?' placeholders in SQL
		  (only use if not passing a DatabaseQuery object)
		* onSuccess (function): method to call on successful query
			+ receives single argument: results as an array of objects
		* onError (function): method to call on error; defaults to logging
	*/
	query: function(sql, options) {
		// Possible that the user closed the connection already, so double check
		if (!this.db) {
			this._db_lost();
			return;
		}
		// Merge in user options (if any) to defaults
		var options = (!Object.isUndefined(options) ? options : {});
		// Check to see if they passed in a query object
		if (!Object.isString(sql)) {
			// Translate into options object and SQL string
			options.values = sql.values;
			sql = sql.sql;
		}
		// Run the actual merge for our options, making sure there's a default values array
		options = this._getOptions(options, {"values": []});
		// SQL won't be executed unless we append the `GO;` command
		// Trim whitespace to make sure we can accurately check character positions
		sql = sql.strip();
		if (sql.lastIndexOf(';') != sql.length - 1) {
			sql = sql + ';';
		}
		if (sql.indexOf('GO;') == -1) {
			sql = sql + ' GO;';
		}
		// Run the transaction
		this.db.transaction(function(transaction) {
			// TEMP: Spams the log, but really handy for debugging right now
			Mojo.Log.info(sql, ' ==> ', options.values);
			transaction.executeSql(sql, options.values, function(transaction, results) {
				// We use this anonymous function to format the results
				// Just passing the SQLResultSet object would require SQLite-specific code on the part of the callback
				
				// Try to snag the last insert ID, if available
				try {
					this.lastInsertRowId = results.insertId;
				} catch(e) {}
				// Call the onSuccess with formatted results
				if (options.onSuccess) {
					options.onSuccess(this._convertResultSet(results));
				}
			}.bind(this), options.onError);
		}.bind(this));
	},
	
	/*
	Execute multiple arbitrary SQL queries on the database as a single transaction (group of inserts, for instance)
	
	Notes:
	- Not appropriate for SELECT or anything with returned rows
	- The last inserted ID will NOT be set when using this method
	- onSuccess and onError are only for the transaction! NOT individual queries
	
	Parameters:
	- queries (array, required):
		* SQL strings or DatabaseQuery objects
	- options (object):
		* onSuccess: function to execute on TRANSACTION success
		* onError: function to execute on TRANSACTION error
	*/
	queries: function(queries, options) {
		// Possible that the user closed the connection already, so double check
		if (!this.db) {
			this._db_lost();
			return;
		}
		// Merge in user options (if any) to defaults
		var options = (!Object.isUndefined(options) ? options : {});
		options = this._getOptions(options);
		// Run the transaction
		this.db.transaction(function(transaction) {
			// Loop over each query and execute it
			queries.each(function(query) {
				var sql = '';
				var values = [];
				// If query isn't a string, it's an object
				if (Object.isString(query)) {
					sql = query;
				} else {
					sql = query.sql;
					values = query.values;
				}
				// TEMP: logging is good for the soul right now
				Mojo.Log.info(sql, " ==> ", values);
				transaction.executeSql(sql, values);
			});
		}, options.onError, options.onSuccess);
	},
	
	
	// === JSON methods ===
	
	/*
	A core goal of the Database class is to enable you to easily port data
	into your database using JSON.
	
	setSchema defines/inserts a table layout (if it doesn't already exist)
	and inserts any data that you've provided inline
	
	Parameters:
	- schema (object): see advanced description below
	- options (object):
		* onSuccess (function): called after successful transactions
		* onError (function): called on error for transactions
	
	PLEASE NOTE: the onSuccess and onError functions may be called multiple
	times if you are inserting data as well as defining a table schema.
	
	Schema Description
	==================
	
	An array of table objects, which each contain an array of columns objects
	and an optional array of data to insert
	
	Array of table objects (optional if single table) =>
		table Object =>
			table (text, required; name of the table)
			columns (array) =>
				column (text, required; name of the column)
				type (text, required)
				constraints (array of strings)
			data (array) =>
				Object (keys are the names of the columns)
	
	Both columns and data are optionally; you can use setSchema to
	define the table schema, populate with data, or both.
	
	Obviously, it's better practice to populate with data only when you
	need to, whereas you'll likely be defining tables every time you
	instantiate the Database class.
	
	JSON example
	============
	
	[
		{
			table: "table1",
			columns: [
				{
					column: "entry_id",
					type: "INTEGER",
					constraints: ["PRIMARY_KEY"]
				},
				{
					column: "title",
					type: "TEXT"
				}
			],
			data: [
				{ entry_id: "1", title: "My first entry" },
				{ entry_id: "2", title: "My second entry" }
			]
		}
	]
	*/
	
	setSchema: function(schema, options) {
		// Check to see if it's a single table, make array for convenience
		if (!Object.isArray(schema)) {
			schema = [schema];
		}
		// Merge in user options (if any) to defaults
		var options = (!Object.isUndefined(options) ? options : {});
		options = this._getOptions(options);
		// Setup array to track table creation SQL
		var tableQueries = [];
		// Setup array to track data (just in case)
		var data = [];
		// Loop over the tables
		schema.each(function(table) {
			// Check for and save columns object
			if (!Object.isUndefined(table.columns)) {
				tableQueries.push(this.getCreateTable(table.table, table.columns));
			}
			// Check for and save data array
			if (!Object.isUndefined(table.data)) {
				data.push({"table": table.table, "data": table.data});
			}
		}.bind(this));
		if (data.length > 0) {
			// Setup a synchronizer to allow the data insertion to proceed after table creation
			var synchronizer = Mojo.Function.Synchronize({
				syncCallback: this.insertData.bind(this, data, options)
			});
			var wrapTrigger = synchronizer.wrap(function() {});
			// Execute the queries
			this.queries(tableQueries, {
				onSuccess: wrapTrigger,
				onError: options.onError
			});
		} else {
			this.queries(tableQueries, options);
		}
	},
	
	/*
	Allows you to set your schema using an arbitrary JSON file.
	
	Parameters:
		- url (string, required): local or remote URL for JSON file
		- options (object): same as setSchema options (above)
	*/
	setSchemaFromURL: function(url, options) {
		this._readURL(url, this.setSchema.bind(this), options);
	},
	
	/*
	Inserts arbitrary data from a Javascript object
	
	Parameters:
	- data (array or object):
		* table (string, required): name of the table to insert into
		* data (array, required): array of objects whose keys are the column names to insert into
	- options (object):
		* onSuccess (function): success callback
		* onError (function): error callback
	
	The formatting is the same as for the schema, just without the columns.
	Note that data can be a single object if only inserting into one table.
	*/
	insertData: function(data, options) {
		// Check to see if it's a single table
		if (!Object.isArray(data)) {
			data = [data];
		}
		// Merge in user options (if any) to defaults
		var options = (!Object.isUndefined(options) ? options : {});
		options = this._getOptions(options);
		// Setup array to track queries
		var dataQueries = [];
		data.each(function(table) {
			// Make sure there's actually a data array
			if (!Object.isUndefined(table.data)) {
				var tableName = table.table;
				// Check to see if we have more than one row of data
				var inserts = null;
				if (!Object.isArray(table.data)) {
					inserts = [table.data]
				} else {
					inserts = table.data;
				}
				inserts.each(function(row) {
					dataQueries.push(this.getInsert(tableName, row));
				}.bind(this));
			}
		}.bind(this));
		// Execute that sucker!
		this.queries(dataQueries, options);
	},
	
	/*
	Allows you to populate data using arbitrary JSON file.
	
	Parameters:
		- url (string, required): local or remote URL for JSON file
		- options (object): same as insertData options (above)
	*/
	insertDataFromURL: function(url, options) {
		this._readURL(url, this.insertData.bind(this), options);
	},
	
	
	// === SQL Methods ===
	
	/*
	SQL to Insert records (create)
	
	Parameters:
	- tableName (string, required)
	- data (object, required):
		* key: value pairs to be updated as column: value (same format as data objects in schema)
	
	Returns DatabaseQuery object
	*/
	getInsert: function(tableName, data) {
		var sql = 'INSERT INTO ' + tableName + ' (';
		var valueString = ' VALUES (';
		// Set up our tracker array for value placeholders
		var colValues = [];
		// Uses Hash.each which results in item.key and item.value
		data = new Hash(data);
		// Grab the length so we know when to stop
		var length = data.keys().length;
		data.each(function(item, index) {
			// Add the value to the valueString
			colValues.push(item.value);
			// Add the placeholders
			sql += item.key;
			valueString += '?';
			// Append commas if not at the end of the list
			if (index < length - 1) {
				sql += ', ';
				valueString += ', ';
			} else {
				sql += ')';
				valueString += ')';
			}
		});
		// Put together the full SQL statement
		sql += valueString;
		// At long last, we've got our SQL; return it
		return new DatabaseQuery(sql, colValues);
	},
	
	/*
	UNTESTED
	SQL for a very simple select
	
	Parameters:
	- tableName (string, required)
	- columns (string, array, or null): names of the columns to return
	- where (object): {key: value} is equated to column: value
	
	Returns DatabaseQuery object
	*/
	getSelect: function(tableName, columns, where) {
		// Convert where to an array if necessary
		if (!Object.isArray(where) && !Object.isUndefined(where)) {
			where = [where];
		}
		var sql = 'SELECT ';
		// Setup our targeted columns
		var colStr = '';
		if (columns == null || columns == '') {
			colStr = '*';
		} else if (Object.isArray(columns)) {
			columns.each(function(col, index) {
				colStr += col;
				// Add comma if we aren't at the end
				if (index < columns.length - 1) {
					colStr += ',';
				}
				colStr += ' ';
			});
		}
		sql += colStr + 'FROM ' + tableName;
		// Parse the WHERE object if we have one
		if (!Object.isUndefined(where)) {
			sql += ' WHERE ';
			var sqlValues = [];
			var whereStrings = [];
			// Convert to Hash for looping with item.key and item.value
			where = new Hash(where);
			// Loop over the where object to populate 
			where.each(function(item) {
				sqlValues.push(item.value);
				whereStrings.push(item.key + ' = ?');
			});
			// Add the WHERE strings to the sql
			sql += whereStrings.join(' AND ');
		}
		return new DatabaseQuery(sql, sqlValues);
	},
	
	/*
	UNTESTED
	SQL to update a particular row
	
	Parameters:
	- tableName (string, required)
	- data (object, required):
		* key: value pairs to be updated as column: value (same format as data objects in schema)
	- where (object): key: value translated to 'column = value'
	
	Returns DatabaseQuery object
	*/
	getUpdate: function(tableName, data, where) {
		// Convert where to an array if necessary
		if (!Object.isArray(where)) {
			where = [where];
		}
		var sql = 'UPDATE ' + tableName + ' SET ';
		var sqlValues = [];
		var sqlStrings = [];
		// Make sure we can use Hash enumerator
		data = new Hash(data);
		data.each(function(item) {
			sqlStrings.push(item.key + ' = ?');
			sqlValues.push(item.value);
		});
		// Collapse sqlStrings into SQL
		sql += sqlStrings.join(', ');
		// Parse the WHERE object
		sql += ' WHERE ';
		var whereStrings = [];
		// Loop over the where object to populate 
		where = new Hash(where);
		where.each(function(item) {
			whereStrings.push(item.key + ' = ?');
			sqlValues.push(item.value);
		});
		// Add the WHERE strings to the sql
		sql += whereStrings.join(' AND ');
		return new DatabaseQuery(sql, sqlValues);
	},
	
	/*
	UNTESTED
	SQL to delete records
	
	Parameters:
	- tableName (string, required)
	- where (object, required): key: value mapped to 'column = value'
	
	Returns DatabaseQuery object
	*/
	getDelete: function(tableName, where) {
		var sql = 'DELETE FROM ' + tableName + ' WHERE ';
		var sqlValues = [];
		var whereStrings = [];
		// Loop over the where object to populate 
		where = new Hash(where);
		where.each(function(item) {
			whereStrings.push(item.key + ' = ?');
			sqlValues.push(item.value);
		});
		// Add the WHERE strings to the sql
		sql += whereStrings.join(' AND ');
		return new DatabaseQuery(sql, sqlValues);
	},
	
	/*
	SQL to create a new table
	
	Parameters:
	- tableName (string, required)
	- columns (array, required): uses syntax from setSchema (see above)
	- ifNotExists (bool, defaults to true)
	
	Returns string, since value substitution isn't supported for this statement in SQLite
	*/
	
	getCreateTable: function(tableName, columns, ifNotExists) {
		var ifNotExists = (!Object.isUndefined(ifNotExists) ? ifNotExists : true);
		// Setup the basic SQL
		var sql = 'CREATE TABLE ';
		if (ifNotExists) {
			sql += 'IF NOT EXISTS ';
		}
		sql += tableName + ' (';
		// Add the column definitions to the SQL
		columns.each(function(col, index) {
			// Construct the string for the column definition
			var colDef = col.column + ' ' + col.type;
			if (col.constraints) {
				col.constraints.each(function(constraint) {
					colDef += ' ' + constraint;
				});
			}
			// Add to SQL
			sql += colDef;
			// Add comma if we aren't at the end of the array
			if (index < columns.length - 1) {
				sql += ', ';
			} else {
				sql += ')';
			}
		});
		return sql;
	},
	
	/*
	SQL for dropping a table
	
	Returns string
	*/
	getDropTable: function(tableName) {
		return 'DROP TABLE IF EXISTS ' + tableName;
	},
	
	// === Private methods ===
	
	/*
	Merge user options into the standard set
	
	Parameters:
	- userOptions (object, required): options passed by the user
	- extraOptions (object, optional) any default options beyond onSuccess and onError
	*/
	_getOptions: function(userOptions, extraOptions) {
		var opts = new Hash({
			"onSuccess": Prototype.emptyFunction,
			"onError": this._errorHandler.bind(this)
		});
		if (!Object.isUndefined(extraOptions)) {
			opts.merge(extraOptions);
		}
		if (Object.isUndefined(userOptions)) {
			var userOptions = {};
		}
		return opts.merge(userOptions).toObject();
	},
	
	/* Used to read in external JSON files */
	_readURL: function(url, callback, options) {
		new Ajax.Request(url, {
			method: 'get',
			onSuccess: function(response) {
				try {
					var json = response.responseText.evalJSON(true);
					callback(json, options);
				} catch (e) {
					Mojo.Log.error('JSON request error:', e);
				}
			},
			onFailure: function(failure) {
				Mojo.Log.error('Database: failed to read JSON at URL `' + url + '`');
			}
		});
	},
	
	/* Converts an SQLResultSet into a standard Javascript array of results */
	_convertResultSet: function(rs) {
		var results = [];
		if (rs.rows) {
			for (var i = 0; i < rs.rows.length; i++) {
				results.push(rs.rows.item(i));
			}
		}
		return results;
	},
	
	/* Used to report generic database errors */
	_errorHandler: function(transaction, error) {
		// If a transaction error (rather than an executeSQL error) there might only be one parameter
		if (Object.isUndefined(error)) {
			var error = transaction;
		}
		Mojo.Log.error('Database error (' + error.code + '): ' + error.message);
	},
	
	/* Used to output "database lost" error */
	_db_lost: function() {
		Mojo.Log.error('Database: connection has been closed or lost; cannot execute SQL');
	}
});

/*
DatabaseQuery (class)

This is a helper class that, at the moment, is basically just an object with standard properties.

Maybe down the road I'll add some helper methods for working with queries.

USAGE:
var myQuery = new DatabaseQuery('SELECT * FROM somwehere WHERE id = ?', ['someID']);
console.log(myQuery.sql);
consol.log(myQuery.values);
*/

var DatabaseQuery = Class.create({
	initialize: function(sql, values) {
		this.sql = sql;
		this.values = values;
	}
});