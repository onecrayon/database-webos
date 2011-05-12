/*
---

script: database.js

description: Provides a simplified interface to HTML 5 database objects

license: MIT license <http://www.opensource.org/licenses/mit-license.php>

authors:
- Ian Beck

version: 2.0.0

Core class design based on the Mootools Database class by André Fiedler:
http://github.com/SunboX/mootools-database/

Schema definitions based on Mojo Database Helper Objects by Dave Freeman:
http://webos101.com/Mojo_Database_Helper_Objects

...
*/

/**
 * Database (class)
 *
 * This is the class you'll be using in your own code. Provides shortcuts
 * to common HTML 5 SQLite database operations.
 *
 * Parameters:
 * - name (string, required): name of your database; prefix with ext: to allow >1 MB sizes
 * - version (string): version of the database you want to open/create
 * - estimatedSize (int): estimated size in bytes
 * - debug (bool): if true, outputs verbose debugging messages (mainly SQL that's being run)
 *
 * USAGE:
 * var db = new Database('database-name', '1', null, false);
 */
var Database = function(name, version, estimatedSize, debug) {
	if (typeof name !== 'string') {
		throw new Error('Database class constructor requires name argument');
		return undefined;
	}
	// Setup public properties
	this.name = name;
	this.version = (arguments.length >= 2 ? version : '1');
	this.estimatedSize = (arguments.length >= 3 ? estimatedSize : null);
	this.debug = (arguments.length >= 4 ? debug : false);
	this.debug = (this.debug);
	
	// Open connection to database, and setup protected properties
	// parameters: name, version, displayName [unused anywhere that I know of], target size
	this._db = openDatabase(this.name, this.version, '', this.estimatedSize);
	// Make sure everything is peachy
	if (!this._db) {
		throw new Error('Database: failed to open database named ' + this.name);
		return undefined;
	}
	// Save the database version, in case it differs from options
	this._dbVersion = this._db.version;
	// Init lastInsertRowId
	this._lastInsertRowId = 0;
	
	// Setup bound functions; increases memory footprint, but speeds performance
	this.bound = {
		setSchema: this._bind(this, this.setSchema),
		insertData: this._bind(this, this.insertData),
		_errorHandler: this._bind(this, this._errorHandler)
	};
}

// === Standard database methods ===

/**
 * Fetch the version of the database
 */
Database.prototype.getVersion = function() {
	return this._dbVersion;
}

/**
 * Exposes the last ID inserted
 */
Database.prototype.lastInsertId = function() {
	return this._lastInsertRowId;
}

/**
 * Close the database connection
 *
 * Why you'd want to do this, I don't know; may as well support it, though
 */
Database.prototype.close = function() {
	this._db.close();
}

/**
 * Destroy the entire database for the given version (if passed)
 *
 * If only there were a way to actually do this...
 */
Database.prototype.destroy = function(version) {
	if (console && console.log) {
		console.log('Database: there is currently no way to destroy a database. Hopefully we will be able to add this in the future.');
	}
}

/**
 * Execute an arbitrary SQL command on the database.
 *
 * If you need to execute multiple commands in a transaction, use queries()
 *
 * Parameters:
 * - sql (string or query object, required)
 * - options (object):
 *    * values (array): replacements for '?' placeholders in SQL
 *      (only use if not passing a DatabaseQuery object)
 *    * onSuccess (function): method to call on successful query
 *        + receives single argument: results as an array of objects
 *    * onError (function): method to call on error; defaults to logging
 */
Database.prototype.query = function(sql, options) {
	// Possible that the user closed the connection already, so double check
	if (!this._db) {
		this._db_lost();
		return;
	}
	// Merge in user options (if any) to defaults
	var options = (typeof options !== 'undefined' ? options : {});
	// Check to see if they passed in a query object
	if (typeof sql !== 'string') {
		// Translate into options object and SQL string
		options.values = sql.values;
		sql = sql.sql;
	}
	// Run the actual merge for our options, making sure there's a default values array
	options = this._getOptions(options, {"values": []});
	// Trim whitespace to make sure we can accurately check character positions
	sql = sql.replace(/(^\s*|\s*$)/g, '');
	if (sql.lastIndexOf(';') !== sql.length - 1) {
		sql = sql + ';';
	}
	// Run the transaction
	var self = this;
	this._db.transaction(function(transaction) {
		if (self.debug) {
			// Output the query to the log for debugging
			console.log(sql, ' ==> ', options.values);
		}
		transaction.executeSql(sql, options.values, function(transaction, results) {
			// We use this anonymous function to format the results
			// Just passing the SQLResultSet object would require SQLite-specific code on the part of the callback
			
			// Try to snag the last insert ID, if available
			try {
				self._lastInsertRowId = results.insertId;
			} catch(e) {}
			// Call the onSuccess with formatted results
			if (options.onSuccess) {
				options.onSuccess(self._convertResultSet(results));
			}
		}, options.onError);
	});
}

/**
 * Execute multiple arbitrary SQL queries on the database as a single
 * transaction (group of inserts, for instance)
 *
 * Notes:
 * - Not appropriate for SELECT or anything with returned rows
 * - The last inserted ID will NOT be set when using this method
 * - onSuccess and onError are only for the transaction! NOT individual queries
 *
 * Parameters:
 * - queries (array, required):
 *    * SQL strings or DatabaseQuery objects
 * - options (object):
 *    * onSuccess: function to execute on LAST QUERY success
 *    * onError: function to execute on TRANSACTION error
 */
Database.prototype.queries = function(queries, options) {
	// Possible that the user closed the connection already, so double check
	if (!this._db) {
		this._db_lost();
		return;
	}
	// Merge in user options (if any) to defaults
	var options = (typeof options !== 'undefined' ? options : {});
	options = this._getOptions(options);
	// Run the transaction
	var DEBUG = this.debug;
	this._db.transaction(function(transaction) {
		// Loop over each query and execute it
		var length = queries.length;
		var query = null;
		// Init variables for tracking SQL and values
		var sql = '';
		var values = [];
		for (var i = 0; i < length; i++) {
			query = queries[i];
			// If query isn't a string, it's an object
			if (typeof query === 'string') {
				sql = query;
			} else {
				sql = query.sql;
				values = query.values;
			}
			if (debug) {
				// Output query to the log for debugging
				console.log(sql, " ==> ", values);
			}
			if (i === length - 1) {
				// Last call
				transaction.executeSql(sql, values, options.onSuccess);
			} else {
				transaction.executeSql(sql, values);
			}
		}
	}, options.onError);
}


// === JSON methods ===

/**
 * A core goal of the Database class is to enable you to easily port data
 * into your database using JSON.
 *
 * setSchema defines/inserts a table layout (if it doesn't already exist)
 * and inserts any data that you've provided inline
 *
 * Parameters:
 * - schema (object): see advanced description below
 * - options (object):
 *    * onSuccess (function): called after successful transactions
 *    * onError (function): called on error for transactions
 *
 * PLEASE NOTE: the onSuccess and onError functions may be called multiple
 * times if you are inserting data as well as defining a table schema.
 * 
 * Schema Description
 * ==================
 *
 * An array of table objects, which each contain an array of columns objects
 * and an optional array of data to insert
 * 
 * Array of table objects (optional if single table) =>
 *     table Object =>
 *         table (text, required; name of the table)
 *         columns (array) =>
 *             column (text, required; name of the column)
 *             type (text, required)
 *             constraints (array of strings)
 *         data (array) =>
 *             Object (keys are the names of the columns)
 *     string (executed as a straight SQL query)
 *
 * Both columns and data are optionally; you can use setSchema to
 * define the table schema, populate with data, or both.
 *
 * Obviously, it's better practice to populate with data only when you
 * need to, whereas you'll likely be defining tables every time you
 * instantiate the Database class.
 *
 * You may also use an SQL string instead of a table object if you desire.
 * This is useful for running batch updates to modify existing schema, for
 * instance, as you can mix and match new tables with ALTER TABLE statements.
 *
 * JSON example
 * ============
 *
 * [
 *     {
 *         "table": "table1",
 *         "columns": [
 *             {
 *                 "column": "entry_id",
 *                 "type": "INTEGER",
 *                 "constraints": ["PRIMARY_KEY"]
 *             },
 *             {
 *                 "column": "title",
 *                 "type": "TEXT"
 *             }
 *         ],
 *         "data": [
 *             { "entry_id": "1", "title": "My first entry" },
 *             { "entry_id": "2", "title": "My second entry" }
 *         ]
 *     },
 *     "ALTER TABLE table1 ADD COLUMN category TEXT"
 * ]
 */
Database.prototype.setSchema = function(schema, options) {
	// Check to see if it's a single table, make array for convenience
	if (!this._isArray(schema)) {
		schema = [schema];
	}
	// Merge in user options (if any) to defaults
	var options = (typeof options !== 'undefined' ? options : {});
	options = this._getOptions(options);
	// Setup array to track table creation SQL
	var tableQueries = [];
	// Setup array to track data (just in case)
	var data = [];
	// Loop over the tables
	var length = schema.length;
	var table = null;
	for (var i = 0; i < length; i++) {
		table = schema[i];
		// Check to see if we have an SQL string
		if (typeof table === 'string') {
			tableQueries.push(table);
		} else {
			// Check for and save columns object
			if (typeof table.columns !== 'undefined') {
				tableQueries.push(this.getCreateTable(table.table, table.columns));
			}
			// Check for and save data array
			if (typeof table.data !== 'undefined') {
				data.push({"table": table.table, "data": table.data});
			}
		}
	}
	if (data.length > 0) {
		var dataInsertFollowup = this._bind(this, this.insertData, data, options);
		// Execute the queries
		this.queries(tableQueries, {
			onSuccess: dataInsertFollowup,
			onError: options.onError
		});
	} else {
		this.queries(tableQueries, options);
	}
}


/**
 * Allows you to set your schema using an arbitrary JSON file.
 *
 * Parameters:
 *     - url (string, required): local or remote URL for JSON file
 *     - options (object): same as setSchema options (above)
 */
Database.prototype.setSchemaFromURL = function(url, options) {
	this._readURL(url, this.bound.setSchema, options);
}

/**
 * Inserts arbitrary data from a Javascript object
 *
 * Parameters:
 * - data (array or object):
 *     * table (string, required): name of the table to insert into
 *     * data (array, required): array of objects whose keys are the column
 *       names to insert into
 * - options (object):
 *     * onSuccess (function): success callback
 *     * onError (function): error callback
 *
 * The formatting is the same as for the schema, just without the columns.
 * Note that data can be a single object if only inserting into one table.
 */
Database.prototype.insertData = function(data, options) {
	// Check to see if it's a single table
	if (!this._isArray(data)) {
		data = [data];
	}
	// Merge in user options (if any) to defaults
	var options = (typeof options !== 'undefined' ? options : {});
	options = this._getOptions(options);
	// Setup array to track queries
	var dataQueries = [];
	var length = data.length;
	var table = null;
	var i, j;
	var insertsLength = 0;
	var row = null;
	for (i = 0; i < length; i++) {
		table = data[i];
		// Make sure there's actually a data array
		if (typeof table.data !== 'undefined') {
			var tableName = table.table;
			// Check to see if we have more than one row of data
			var inserts = null;
			if (!this._isArray(table.data)) {
				inserts = [table.data]
			} else {
				inserts = table.data;
			}
			// Nested loop to fetch the data inserts
			insertsLength = inserts.length;
			for (j = 0; j < insertsLength; j++) {
				row = inserts[j];
				dataQueries.push(this.getInsert(tableName, row));
			}
		}
	}
	// Execute that sucker!
	this.queries(dataQueries, options);
}

/**
 * Allows you to populate data using arbitrary JSON file.
 *
 * Parameters:
 * - url (string, required): local or remote URL for JSON file
 * - options (object): same as insertData options (above)
 */
Database.prototype.insertDataFromURL = function(url, options) {
	this._readURL(url, this.bound.insertData, options);
}


// === VERSIONING METHODS ===

/**
 * Change the version of the database; allows porting data when
 * upgrading schema
 *
 * WARNING: you must have NO other database connections active when you
 * do this, and remember that afterward you will need to use the new
 * version in your `new Database()` calls.
 */
Database.prototype.changeVersion = function(newVersion) {
	// Backwards compatibility with previous incarnation which was changeVersion(from, to)
	if (arguments.length > 1) {
		newVersion = arguments[1];
	}
	var self = this;
	this._db.changeVersion(this._dbVersion, newVersion, function() {}, function() {
		if (self.debug) {
			console.log("DATABASE VERSION UPDATE FAILED: " + newVersion);
		}
	}, function() {
		if (self.debug) {
			console.log("DATABASE VERSION UPDATE SUCCESS: " + newVersion);
		}
	});
	this._dbVersion = newVersion;
}

/**
 * Change the version of the database and apply any schema updates
 * specified in the `schema` object
 *
 * NOTE: You cannot insert data with this call. Instead, run your schema
 * update and then use insertData in your success callback
 *
 * Parameters:
 * - newVersion (string or int)
 * - schema (object or string): same as setSchema (documented above),
 *   minus any data insertion support
 * - options (object): same as setSchema options
 */
Database.prototype.changeVersionWithSchema = function(newVersion, schema, options) {
	// Check to see if it's a single table, make array for convenience
	if (!this._isArray(schema)) {
		schema = [schema];
	}
	// Merge in user options (if any) to defaults
	var options = (typeof options !== 'undefined' ? options : {});
	options = this._getOptions(options);
	
	// Run the changeVersion update!
	this._db.changeVersion(this._dbVersion, newVersion, this._bind(this, function(transaction) {
		// Loop over the items in the schema
		var length = schema.length;
		var item = null, query = null, sql = null, values = null;
		for (var i = 0; i < length; i++) {
			item = schema[i];
			// Check to see if we have an SQL string or table definition
			if (typeof item === 'string') {
				query = item;
			} else if (typeof item.columns !== 'undefined') {
				query = this.getCreateTable(item.table, item.columns);
			}
			
			// Run the query
			sql = (typeof query === 'string' ? query : query.sql);
			values = (typeof query.values !== 'undefined' ? query.values : null);
			if (this.debug) {
				// Output the query to the log for debugging
				console.log(sql, ' ==> ', values);
			}
			if (values !== null) {
				transaction.executeSql(sql, values);
			} else {
				transaction.executeSql(sql);
			}
		}
	}), options.onError, this._bind(this, this._versionChanged, newVersion, options.onSuccess));
}

/**
 * Change the version of the database and apply any schema updates
 * specified in the schema JSON file located at `url`
 */
Database.prototype.changeVersionWithSchemaFromURL = function(newVersion, url, options) {
	this._readURL(url, this._bind(this, this.changeVersionWithSchema, newVersion));
}


// === SQL Methods ===

/**
 * SQL to Insert records (create)
 *
 * Parameters:
 * - tableName (string, required)
 * - data (object, required):
 *     * key: value pairs to be updated as column: value (same format as data
 *       objects in schema)
 *
 * Returns DatabaseQuery object
 */
Database.prototype.getInsert = function(tableName, data) {
	var sql = 'INSERT INTO ' + tableName + ' (';
	var valueString = ' VALUES (';
	// Set up our tracker array for value placeholders
	var colValues = [];
	// Loop over the keys in our object
	for (var key in data) {
		// Add the value to the valueString
		colValues.push(data[key]);
		// Add the placeholders
		sql += key;
		valueString += '?';
		// Append commas
		sql += ', ';
		valueString += ', ';
	}
	// Remove extra commas and insert closing parentheses
	sql = sql.substr(0, sql.length - 2) + ')';
	valueString = valueString.substr(0, valueString.length - 2) + ')';
	// Put together the full SQL statement
	sql += valueString;
	// At long last, we've got our SQL; return it
	return new DatabaseQuery({'sql': sql, 'values': colValues});
}

/**
 * SQL for a very simple select
 *
 * Parameters:
 * - tableName (string, required)
 * - columns (string, array, or null): names of the columns to return
 * - where (object): {key: value} is equated to column: value
 *
 * Returns DatabaseQuery object
 */
Database.prototype.getSelect = function(tableName, columns, where) {
	var sql = 'SELECT ';
	// Setup our targeted columns
	var colStr = '';
	if (columns === null || columns === '') {
		colStr = '*';
	} else if (this._isArray(columns)) {
		// Cut down on memory needs with a straight for loop
		var length = columns.length;
		var colStr = [];
		for (var i = 0; i < length; i++) {
			colStr.push(columns[i]);
		}
		// Join the column string together with commas
		colStr = colStr.join(', ');
	}
	sql += colStr + ' FROM ' + tableName;
	// Parse the WHERE object if we have one
	if (typeof where !== 'undefined') {
		sql += ' WHERE ';
		var sqlValues = [];
		var whereStrings = [];
		// Loop over the where object to populate
		for (var key in where) {
			sqlValues.push(where[key]);
			whereStrings.push(key + ' = ?');
		}
		// Add the WHERE strings to the sql
		sql += whereStrings.join(' AND ');
	}
	return new DatabaseQuery({'sql': sql, 'values': sqlValues});
}

/**
 * SQL to update a particular row
 *
 * Parameters:
 * - tableName (string, required)
 * - data (object, required):
 *     * key: value pairs to be updated as column: value (same format as
 *       data objects in schema)
 * - where (object): key: value translated to 'column = value'
 *
 * Returns DatabaseQuery object
 */
Database.prototype.getUpdate = function(tableName, data, where) {
	var sql = 'UPDATE ' + tableName + ' SET ';
	var sqlValues = [];
	var sqlStrings = [];
	// Loop over data object
	for (var key in data) {
		sqlStrings.push(key + ' = ?');
		sqlValues.push(data[key]);
	}
	// Collapse sqlStrings into SQL
	sql += sqlStrings.join(', ');
	// Parse the WHERE object
	sql += ' WHERE ';
	var whereStrings = [];
	// Loop over the where object to populate
	for (var key in where) {
		whereStrings.push(key + ' = ?');
		sqlValues.push(where[key]);
	}
	// Add the WHERE strings to the sql
	sql += whereStrings.join(' AND ');
	return new DatabaseQuery({'sql': sql, 'values': sqlValues});
}

/**
 * SQL to delete records
 *
 * Parameters:
 * - tableName (string, required)
 * - where (object, required): key: value mapped to 'column = value'
 *
 * Returns DatabaseQuery object
 */
Database.prototype.getDelete = function(tableName, where) {
	var sql = 'DELETE FROM ' + tableName + ' WHERE ';
	var sqlValues = [];
	var whereStrings = [];
	// Loop over the where object to populate
	for (var key in where) {
		whereStrings.push(key + ' = ?');
		sqlValues.push(where[key]);
	}
	// Add the WHERE strings to the sql
	sql += whereStrings.join(' AND ');
	return new DatabaseQuery({'sql': sql, 'values': sqlValues});
}

/**
 * SQL to create a new table
 *
 * Parameters:
 * - tableName (string, required)
 * - columns (array, required): uses syntax from setSchema (see above)
 * - ifNotExists (bool, defaults to true)
 *
 * Returns string, since value substitution isn't supported for this
 * statement in SQLite
 */
Database.prototype.getCreateTable = function(tableName, columns, ifNotExists) {
	var ifNotExists = (typeof ifNotExists !== 'undefined' ? ifNotExists : true);
	// Setup the basic SQL
	var sql = 'CREATE TABLE ';
	if (ifNotExists) {
		sql += 'IF NOT EXISTS ';
	}
	sql += tableName + ' (';
	// Add the column definitions to the SQL
	var length = columns.length;
	var col = null;
	var colStr = [];
	var colDef = '';
	for (var i = 0; i < length; i++) {
		col = columns[i];
		// Construct the string for the column definition
		colDef = col.column + ' ' + col.type;
		if (col.constraints) {
			colDef += ' ' + col.constraints.join(' ');
		}
		// Add to SQL
		colStr.push(colDef);
	}
	sql += colStr.join(', ') + ')';
	return sql;
}

/**
 * SQL for dropping a table
 *
 * Returns string
 */
Database.prototype.getDropTable = function(tableName) {
	return 'DROP TABLE IF EXISTS ' + tableName;
}


// === Private methods ===

/**
 * @protected
 * Sets the local tracking variable for the DB version
 *
 * PRIVATE FUNCTION; use the changeVersion* functions to modify
 * your database's version information
 */
Database.prototype._versionChanged = function(newVersion, callback) {
	this._dbVersion = newVersion;
	callback();
}

/**
 * @protected
 * Merge user options into the standard set
 * 
 * Parameters:
 * - userOptions (object, required): options passed by the user
 * - extraOptions (object, optional) any default options beyond onSuccess
 *   and onError
 */
Database.prototype._getOptions = function(userOptions, extraOptions) {
	var opts = {
		"onSuccess": this._emptyFunction,
		"onError": this.bound._errorHandler
	};
	if (typeof extraOptions !== 'undefined') {
		opts = this._mixin(opts, extraOptions);
	}
	if (typeof userOptions === 'undefined') {
		var userOptions = {};
	}
	return this._mixin(opts, userOptions);
}

/** @protected */
Database.prototype._emptyFunction = function() {}

/**
 * @protected
 * Used to read in external JSON files
 */
Database.prototype._readURL = function(url, callback, options) {
	// Send our request
	// We cannot use a Prototype request, because Prototype injects a bunch of useless crap that fucks up Dropbox's OAuth parsing
	var transport = new XMLHttpRequest();
	transport.open("get", url, true);
	transport.setRequestHeader('Content-Type', 'application/x-www-form-urlencoded; charset=UTF-8');
	var self = this;
	transport.onreadystatechange = function() {
		// Only respond once the request is complete
		if (transport.readyState === 4) {
			// Shorten that thing up
			var status = transport.status;
			if (!status || (status >= 200 && status < 300) || status === 304) {
				try {
					var json = JSON.parse(transport.responseText);
					callback(json, options);
				} catch (e) {
					if (console && console.log) {
						console.log('JSON request error:', e);
					}
				}
			} else {
				throw new Error('Database: failed to read JSON at URL `' + url + '`');
			}
		}
	};
	// Launch 'er!
	transport.send();
}

/**
 * @protected
 * Converts an SQLResultSet into a standard Javascript array of results
 */
Database.prototype._convertResultSet = function(rs) {
	var results = [];
	if (rs.rows) {
		for (var i = 0; i < rs.rows.length; i++) {
			results.push(rs.rows.item(i));
		}
	}
	return results;
}

/**
 * @protected
 * Used to report generic database errors
 */
Database.prototype._errorHandler = function(transaction, error) {
	// If a transaction error (rather than an executeSQL error) there might only be one parameter
	if (typeof error === 'undefined') {
		var error = transaction;
	}
	if (console && console.log) {
		console.log('Database error (' + error.code + '): ' + error.message);
	}
}

/**
 * @protected
 * Used to output "database lost" error
 */
Database.prototype._db_lost = function() {
	throw new Error('Database: connection has been closed or lost; cannot execute SQL');
}

/**
 * @protected
 * Detects if the variable is an array or not
 */
Database.prototype._isArray = function(testIt) {
	return Object.prototype.toString.apply(it) === '[object Array]';
}

/**
 * @protected
 * Returns bound version of the function
 */
Database.prototype._bind = function(scope, method/*, bound arguments*/) {
	return function(){ return method.apply(scope, arguments || []); }
}

Database.prototype._mixin = function(target, source) {
	target = target || {};
	if (source) {
		var name;
		for (name in source) {
			target[name] = source[name];
		}
	}
	return target; 
}

/**
 * DatabaseQuery (object)
 *
 * This is a helper  that, at the moment, is basically just an object
 * with standard properties.
 *
 * Maybe down the road I'll add some helper methods for working with queries.
 *
 * USAGE:
 * var myQuery = new DatabaseQuery({
 *     sql: 'SELECT * FROM somewhere WHERE id = ?',
 *     values: ['someID']
 * });
 */
DatabaseQuery = function(inProps) {
	this.sql = (typeof inProps.sql !== 'undefined' ? inProps.sql : '');
	this.values = (typeof inProps.values !== 'undefined' ? inProps.values : []);
};
